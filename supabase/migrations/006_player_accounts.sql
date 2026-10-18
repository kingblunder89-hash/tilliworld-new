-- Tilliworld: миграция 006 — аккаунты игроков по нику и паролю прямо в базе проекта (без Supabase Auth и без почты).
-- Применять ПОСЛЕ 004 (005 можно пропустить; если она применена, ниже триггер снимается). Повторный запуск безопасен.
--
-- Как это работает: игрок регистрируется/входит через функции player_register / player_login и получает случайный токен
-- (в базе хранится только sha256 токена). Сайт отправляет его в заголовке x-player-token, функция player_uid() находит игрока.
-- Пароли хранятся как bcrypt (pgcrypto). Администраторы по-прежнему входят через Supabase Auth (app_metadata.role = 'admin'):
-- аккаунты игроков и администраторов никак не пересекаются, поэтому игрок не может получить права администратора.

create extension if not exists pgcrypto with schema extensions;

drop trigger if exists on_auth_user_created_player on auth.users;
drop function if exists public.handle_new_player();

create table if not exists public.player_accounts (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (nickname ~ '^[A-Za-z0-9_]{3,16}$'),
  nickname_lower text generated always as (lower(nickname)) stored unique,   -- ник регистронезависимо уникален
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.player_sessions (
  token_hash bytea primary key,
  player_id uuid not null references public.player_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists player_sessions_player on public.player_sessions (player_id);
create table if not exists public.player_login_failures (
  nickname_lower text not null,
  at timestamptz not null default now()
);
create index if not exists player_login_failures_nick on public.player_login_failures (nickname_lower, at desc);

alter table public.player_accounts enable row level security;
alter table public.player_sessions enable row level security;
alter table public.player_login_failures enable row level security;
revoke all on public.player_accounts, public.player_sessions, public.player_login_failures from anon, authenticated;

-- Данные игроков теперь ссылаются на player_accounts, а не на auth.users. Строки старых (Supabase Auth) игроков удаляются:
-- регистрации игроков через Auth больше нет. Отзывы остаются, но становятся «старыми» (без аккаунта).
alter table public.player_profiles drop constraint if exists player_profiles_user_id_fkey;
alter table public.minecraft_links drop constraint if exists minecraft_links_user_id_fkey;
alter table public.minecraft_link_codes drop constraint if exists minecraft_link_codes_user_id_fkey;
alter table public.reviews drop constraint if exists reviews_user_id_fkey;
alter table public.review_reports drop constraint if exists review_reports_reporter_id_fkey;
delete from public.player_profiles where user_id not in (select id from public.player_accounts);
delete from public.minecraft_links where user_id not in (select id from public.player_accounts);
delete from public.minecraft_link_codes where user_id not in (select id from public.player_accounts);
delete from public.review_reports where reporter_id not in (select id from public.player_accounts);
update public.reviews set user_id = null where user_id is not null and user_id not in (select id from public.player_accounts);
alter table public.player_profiles add constraint player_profiles_user_id_fkey foreign key (user_id) references public.player_accounts(id) on delete cascade;
alter table public.minecraft_links add constraint minecraft_links_user_id_fkey foreign key (user_id) references public.player_accounts(id) on delete cascade;
alter table public.minecraft_link_codes add constraint minecraft_link_codes_user_id_fkey foreign key (user_id) references public.player_accounts(id) on delete cascade;
alter table public.reviews add constraint reviews_user_id_fkey foreign key (user_id) references public.player_accounts(id) on delete set null;
alter table public.review_reports add constraint review_reports_reporter_id_fkey foreign key (reporter_id) references public.player_accounts(id) on delete cascade;

-- Прямого чтения у игроков нет: всё через функции.
drop policy if exists "own profile" on public.player_profiles;
drop policy if exists "own link" on public.minecraft_links;
revoke select on public.player_profiles, public.minecraft_links from authenticated;

-- ---------- Сессии и вход ----------
create or replace function public.player_token_hash() returns bytea
language plpgsql stable security definer set search_path = public as $$
declare v_headers json; v_token text;
begin
  begin v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  exception when others then return null; end;
  v_token := v_headers ->> 'x-player-token';
  if v_token is null or v_token !~ '^[0-9a-f]{64}$' then return null; end if;
  return sha256(convert_to(v_token, 'UTF8'));
end $$;

-- Текущий игрок по токену из заголовка. Клиент не передаёт id: только случайный токен, который знает сервер.
create or replace function public.player_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select s.player_id from player_sessions s where s.token_hash = public.player_token_hash() and s.expires_at > now()
$$;

create or replace function public.create_player_session(p_player uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from player_sessions where player_id = p_player and expires_at <= now();
  delete from player_sessions where token_hash in (   -- не больше 5 одновременных сессий
    select token_hash from player_sessions where player_id = p_player order by created_at desc offset 4);
  insert into player_sessions (token_hash, player_id, expires_at) values (sha256(convert_to(v_token, 'UTF8')), p_player, now() + interval '30 days');
  return v_token;
end $$;

-- Возвращает {status, token, nickname}. Неудачи возвращаются статусом (а не исключением), чтобы счётчик попыток сохранялся.
create or replace function public.player_register(p_nickname text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_nick text := btrim(coalesce(p_nickname, '')); v_id uuid;
begin
  if v_nick !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'invalid_nickname'; end if;
  if p_password is null or char_length(p_password) < 8 then raise exception 'password_too_short'; end if;
  if char_length(p_password) > 72 then raise exception 'password_too_long'; end if;
  if (select count(*) from player_accounts where created_at > now() - interval '1 minute') >= 30 then raise exception 'rate_limited'; end if;
  insert into player_accounts (nickname, password_hash) values (v_nick, extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
  on conflict (nickname_lower) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('status', 'nick_taken'); end if;
  insert into player_profiles (user_id, nickname) values (v_id, v_nick);
  return jsonb_build_object('status', 'ok', 'token', public.create_player_session(v_id), 'nickname', v_nick);
end $$;

create or replace function public.player_login(p_nickname text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_lower text := lower(btrim(coalesce(p_nickname, ''))); a player_accounts; v_ok boolean;
begin
  if (select count(*) from player_login_failures where nickname_lower = v_lower and at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;
  select * into a from player_accounts where nickname_lower = v_lower;
  if a.id is null then
    perform extensions.crypt(coalesce(p_password, ''), '$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BUk8Xg5y0h0A7P2U8bQe0S3p0n2u'); -- выравниваем время ответа
    v_ok := false;
  else
    v_ok := a.password_hash = extensions.crypt(coalesce(p_password, ''), a.password_hash);
  end if;
  if not v_ok then
    delete from player_login_failures where at < now() - interval '1 day';
    insert into player_login_failures (nickname_lower) values (v_lower);
    return jsonb_build_object('status', 'invalid_credentials');
  end if;
  delete from player_login_failures where nickname_lower = v_lower;
  return jsonb_build_object('status', 'ok', 'token', public.create_player_session(a.id), 'nickname', a.nickname);
end $$;

create or replace function public.player_logout() returns void
language plpgsql security definer set search_path = public as $$
begin delete from player_sessions where token_hash = public.player_token_hash(); end $$;

-- ---------- Функции игрока: теперь по токену (player_uid) вместо Supabase Auth ----------
create or replace function public.save_profile(p_nickname text) returns void
language plpgsql security definer set search_path = public as $$
declare v_nick text := btrim(coalesce(p_nickname, ''));
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  if v_nick !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'invalid_nickname'; end if;
  insert into player_profiles (user_id, nickname) values (public.player_uid(), v_nick)
  on conflict (user_id) do update set nickname = excluded.nickname, updated_at = now();
end $$;

create or replace function public.my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p player_profiles; l minecraft_links; m site_mutes;
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  perform sweep_expired_mutes();
  select * into p from player_profiles where user_id = public.player_uid();
  select * into l from minecraft_links where user_id = public.player_uid();
  m := active_mute_for(public.player_uid());
  return jsonb_build_object(
    'nickname', p.nickname,
    'verified', l.user_id is not null,
    'mc_name', l.mc_name,
    'verified_at', l.verified_at,
    'is_admin', public.is_admin(),
    'mute', case when m.id is null then null else jsonb_build_object('reason', m.reason, 'expires_at', m.expires_at, 'permanent', m.expires_at is null) end);
end $$;

create or replace function public.create_link_code() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 символа без 0/O/1/I: байт % 32 без смещения
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_code text := ''; v_pos int; v_recent timestamptz;
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  select created_at into v_recent from minecraft_link_codes where user_id = public.player_uid();
  if v_recent is not null and v_recent > now() - interval '20 seconds' then raise exception 'rate_limited'; end if;
  -- байты 6 и 8 uuid v4 содержат фиксированные биты версии/варианта, их не используем
  foreach v_pos in array array[0,1,2,3,4,5,9,10] loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_pos) % 32) + 1, 1);
  end loop;
  insert into minecraft_link_codes (user_id, code_hash, expires_at)
  values (public.player_uid(), sha256(convert_to(v_code, 'UTF8')), now() + interval '10 minutes')
  on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = now(), expires_at = excluded.expires_at;
  return jsonb_build_object('code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4), 'expires_at', now() + interval '10 minutes');
end $$;

create or replace function public.unlink_minecraft() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  delete from minecraft_links where user_id = public.player_uid();
  delete from minecraft_link_codes where user_id = public.player_uid();
end $$;

create or replace function public.submit_review(p_rating int, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_body text; v_nick text; v_id uuid;
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  v_body := validate_review(p_rating, p_body);
  select nickname into v_nick from player_profiles where user_id = public.player_uid();
  if v_nick is null then raise exception 'profile_required'; end if;
  perform assert_can_publish(public.player_uid());
  if exists (select 1 from reviews where user_id = public.player_uid()) then raise exception 'review_exists'; end if;
  if (select count(*) from reviews where created_at > now() - interval '1 minute') >= 30 then raise exception 'rate_limited'; end if;
  insert into reviews (user_id, author_name, rating, body, status) values (public.player_uid(), v_nick, p_rating, v_body, 'pending')
  returning id into v_id;                      -- статус всегда pending, клиент его не передаёт
  return v_id;
end $$;

create or replace function public.edit_my_review(p_rating int, p_body text) returns text
language plpgsql security definer set search_path = public as $$
declare r reviews; v_body text;
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  v_body := validate_review(p_rating, p_body);
  select * into r from reviews where user_id = public.player_uid() for update;
  if r.id is null then raise exception 'review_not_found'; end if;
  if r.status = 'hidden' then raise exception 'review_hidden'; end if;
  perform assert_can_publish(public.player_uid());
  if r.rating = p_rating and r.body = v_body then return r.status; end if;
  -- любая правка возвращает отзыв на модерацию: нельзя одобрить одно и подменить текст
  update reviews set rating = p_rating, body = v_body, status = 'pending', edited_at = now(), updated_at = now(),
         moderated_by = null, moderated_at = null where id = r.id;
  return 'pending';
end $$;

create or replace function public.delete_my_review() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  delete from reviews where user_id = public.player_uid();
end $$;

create or replace function public.my_review() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r reviews;
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  select * into r from reviews where user_id = public.player_uid();
  if r.id is null then return null; end if;
  return jsonb_build_object('id', r.id, 'rating', r.rating, 'body', r.body, 'status', r.status,
                            'created_at', r.created_at, 'edited_at', r.edited_at);
end $$;

create or replace function public.submit_report(p_review_id uuid, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r reviews; v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  if p_reason is null or p_reason not in ('spam','abuse','offtopic','false_info','other') then raise exception 'invalid_reason'; end if;
  if char_length(coalesce(v_details, '')) > 300 then raise exception 'details_too_long'; end if;
  select * into r from reviews where id = p_review_id and status = 'approved';
  if r.id is null then raise exception 'review_not_found'; end if;
  if r.user_id = public.player_uid() then raise exception 'cannot_report_own'; end if;
  if (select count(*) from review_reports where reporter_id = public.player_uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;
  begin
    insert into review_reports (review_id, reporter_id, reason, details) values (r.id, public.player_uid(), p_reason, v_details);
  exception when unique_violation then raise exception 'already_reported';
  end;
end $$;


-- ---------- Мут и поиск игроков теперь работают с player_accounts ----------
create or replace function public.admin_issue_mute(p_user_id uuid, p_duration text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_interval interval; v_exp timestamptz; v_id uuid; v_name text := public.admin_label();
  v_nick text; l minecraft_links; v_now timestamptz := now();
begin
  if not public.admin_has('mutes') then raise exception 'forbidden'; end if;
  if char_length(v_reason) < 3 then raise exception 'reason_required'; end if;
  if char_length(v_reason) > 500 then raise exception 'reason_too_long'; end if;
  v_interval := case p_duration when '10m' then interval '10 minutes' when '1h' then interval '1 hour'
                when '24h' then interval '24 hours' when '7d' then interval '7 days' else null end;
  if p_duration is null or (p_duration <> 'permanent' and v_interval is null) then raise exception 'invalid_duration'; end if;
  if p_user_id is null or not exists (select 1 from player_accounts where id = p_user_id) then raise exception 'user_not_found'; end if;
  perform sweep_expired_mutes();
  if (active_mute_for(p_user_id)).id is not null then raise exception 'already_muted'; end if;
  select nickname into v_nick from player_profiles where user_id = p_user_id;
  select * into l from minecraft_links where user_id = p_user_id;
  v_exp := case when v_interval is null then null else v_now + v_interval end;
  insert into site_mutes (user_id, target_nickname, target_mc_uuid, target_mc_name, issued_by, issued_by_name, reason, duration_key, created_at, expires_at)
  values (p_user_id, coalesce(v_nick, l.mc_name), l.mc_uuid, l.mc_name, auth.uid(), v_name, v_reason, p_duration, v_now, v_exp)
  returning id into v_id;
  insert into mute_audit (event_type, mute_id, user_id, target_nickname, target_mc_uuid, admin_id, admin_name, reason, duration_key, issued_at, expires_at, occurred_at)
  values ('issued', v_id, p_user_id, coalesce(v_nick, l.mc_name), l.mc_uuid, auth.uid(), v_name, v_reason, p_duration, v_now, v_exp, v_now);
  return v_id;
end $$;

create or replace function public.admin_search_players(p_query text) returns table (
  user_id uuid, nickname text, mc_name text, mc_uuid uuid, verified boolean, verified_at timestamptz, email_masked text,
  registered_at timestamptz, is_muted boolean, mute_expires_at timestamptz, mute_permanent boolean)
language plpgsql security definer set search_path = public as $$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  if not (public.admin_has('mutes') or public.admin_has('moderate')) then raise exception 'forbidden'; end if;
  if char_length(v_q) < 2 then raise exception 'query_too_short'; end if;
  perform sweep_expired_mutes();
  return query
  select a.id, a.nickname, l.mc_name, l.mc_uuid, (l.user_id is not null), l.verified_at, null::text, a.created_at,
         (am.id is not null), am.expires_at, (am.id is not null and am.expires_at is null)
  from player_accounts a
  left join minecraft_links l on l.user_id = a.id
  left join lateral (select (active_mute_for(a.id)).*) am on true
  where a.nickname ilike '%' || like_escape(v_q) || '%' or l.mc_name ilike '%' || like_escape(v_q) || '%'
     or a.id::text = v_q or l.mc_uuid::text = v_q
  order by a.nickname
  limit 50;
end $$;

-- ---------- Права ----------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('player_token_hash','player_uid','create_player_session','player_register','player_login','player_logout')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
-- Игроки обращаются с anon-ключом + токеном в заголовке; каждая функция сама проверяет токен.
grant execute on function public.player_register(text, text), public.player_login(text, text), public.player_logout(),
  public.save_profile(text), public.my_account(), public.create_link_code(), public.unlink_minecraft(),
  public.submit_review(int, text), public.edit_my_review(int, text), public.delete_my_review(), public.my_review(),
  public.submit_report(uuid, text, text) to anon, authenticated;
