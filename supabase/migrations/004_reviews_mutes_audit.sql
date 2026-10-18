-- Tilliworld: миграция 004 — отзывы игроков, подтверждение Minecraft-аккаунта, ответы администрации,
-- жалобы, муты на сайте, журнал наказаний. Применять ПОСЛЕ 001–003. Повторный запуск безопасен.
--
-- Модель доступа: прямого доступа к новым таблицам у посетителей нет. Все действия идут через SQL-функции
-- (security definer), которые САМИ проверяют роль по JWT (auth.uid(), app_metadata). Клиент не передаёт ни роль,
-- ни id автора, ни время: всё берётся на сервере. Администратор по-прежнему = app_metadata.role = 'admin'.
-- Необязательные права: app_metadata.permissions = ["moderate","mutes","audit"] (или "all").
-- Если ключа permissions нет, администратор имеет все права (как раньше).

-- ---------- 0. Права администраторов ----------
create or replace function public.admin_full() returns boolean language sql stable as $$
  select public.is_admin() and (
    auth.jwt() -> 'app_metadata' -> 'permissions' is null
    or coalesce(auth.jwt() -> 'app_metadata' -> 'permissions' ? 'all', false))
$$;
create or replace function public.admin_has(p_perm text) returns boolean language sql stable as $$
  select public.admin_full() or (public.is_admin() and coalesce(auth.jwt() -> 'app_metadata' -> 'permissions' ? p_perm, false))
$$;

-- ---------- 1. Игроки и подтверждение Minecraft ----------
create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (nickname ~ '^[A-Za-z0-9_]{3,16}$'), -- введённый ник: НЕ доказательство владения
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.minecraft_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mc_uuid uuid not null unique,                                      -- один Minecraft-аккаунт = один аккаунт сайта
  mc_name text not null check (mc_name ~ '^[A-Za-z0-9_]{3,16}$'),
  verified_at timestamptz not null default now()
);
create table if not exists public.minecraft_link_codes (            -- одноразовые коды; хранится только sha256
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists public.minecraft_plugin_keys (           -- ключи серверного плагина; хранится только sha256
  id uuid primary key default gen_random_uuid(),
  label text not null,
  key_hash bytea not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ---------- 2. Отзывы (расширение существующей таблицы) ----------
alter table public.reviews add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.reviews add column if not exists edited_at timestamptz;
alter table public.reviews add column if not exists updated_at timestamptz not null default now();
alter table public.reviews add column if not exists moderated_by uuid;
alter table public.reviews add column if not exists moderated_at timestamptz;
alter table public.reviews drop constraint if exists reviews_status_check;
alter table public.reviews add constraint reviews_status_check check (status in ('pending','approved','rejected','hidden'));
create unique index if not exists reviews_one_per_user on public.reviews (user_id) where user_id is not null;
create index if not exists reviews_status_created on public.reviews (status, created_at desc);

create table if not exists public.review_replies (
  review_id uuid primary key references public.reviews(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  admin_id uuid not null,
  admin_public_name text not null check (char_length(admin_public_name) between 2 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.admin_profiles (                  -- публичное имя администратора (не почта)
  user_id uuid primary key,
  public_name text not null check (char_length(public_name) between 2 and 32),
  updated_at timestamptz not null default now()
);
create table if not exists public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','abuse','offtopic','false_info','other')),
  details text check (details is null or char_length(details) <= 300),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 300),
  unique (review_id, reporter_id)
);
create index if not exists review_reports_status on public.review_reports (status, created_at desc);

-- ---------- 3. Муты и журнал ----------
-- Без внешних ключей на auth.users: история наказаний не должна пропадать при удалении аккаунта.
create table if not exists public.site_mutes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  target_nickname text,
  target_mc_uuid uuid,                 -- копия подтверждённого UUID на момент выдачи: защита от обхода сменой аккаунта
  target_mc_name text,
  issued_by uuid not null,
  issued_by_name text not null,
  reason text not null check (char_length(reason) between 3 and 500),
  duration_key text not null check (duration_key in ('10m','1h','24h','7d','permanent')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid,
  lifted_by_name text,
  lift_reason text check (lift_reason is null or char_length(lift_reason) <= 300),
  check ((duration_key = 'permanent') = (expires_at is null)),
  check ((lifted_at is null) = (lifted_by is null))
);
create index if not exists site_mutes_user on public.site_mutes (user_id, created_at desc);
create index if not exists site_mutes_mc on public.site_mutes (target_mc_uuid) where target_mc_uuid is not null;

create table if not exists public.mute_audit (                       -- append-only
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('issued','expired','lifted')),
  mute_id uuid not null,
  user_id uuid not null,
  target_nickname text,
  target_mc_uuid uuid,
  admin_id uuid,                       -- кто выдал / снял; null для истечения срока
  admin_name text,
  reason text,                         -- причина наказания
  duration_key text,
  issued_at timestamptz,
  expires_at timestamptz,
  lift_reason text,
  occurred_at timestamptz not null,    -- когда событие произошло (для истечения: момент expires_at)
  recorded_at timestamptz not null default now()
);
create index if not exists mute_audit_occurred on public.mute_audit (occurred_at desc);
create index if not exists mute_audit_user on public.mute_audit (user_id);
create unique index if not exists mute_audit_one_issued  on public.mute_audit (mute_id) where event_type = 'issued';
create unique index if not exists mute_audit_one_expired on public.mute_audit (mute_id) where event_type = 'expired';
create unique index if not exists mute_audit_one_lifted  on public.mute_audit (mute_id) where event_type = 'lifted';

create or replace function public.mute_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_immutable'; end $$;
drop trigger if exists mute_audit_no_change on public.mute_audit;
create trigger mute_audit_no_change before update or delete on public.mute_audit for each row execute function public.mute_audit_immutable();
drop trigger if exists mute_audit_no_truncate on public.mute_audit;
create trigger mute_audit_no_truncate before truncate on public.mute_audit for each statement execute function public.mute_audit_immutable();

-- ---------- 4. RLS и права: прямых записей нет ----------
alter table public.player_profiles enable row level security;
alter table public.minecraft_links enable row level security;
alter table public.minecraft_link_codes enable row level security;
alter table public.minecraft_plugin_keys enable row level security;
alter table public.review_replies enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.review_reports enable row level security;
alter table public.site_mutes enable row level security;
alter table public.mute_audit enable row level security;

drop policy if exists "own profile" on public.player_profiles;
create policy "own profile" on public.player_profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists "own link" on public.minecraft_links;
create policy "own link" on public.minecraft_links for select to authenticated using (user_id = auth.uid());
drop policy if exists "audit readers" on public.mute_audit;
create policy "audit readers" on public.mute_audit for select to authenticated using (public.admin_has('audit'));
drop policy if exists "mute readers" on public.site_mutes;
create policy "mute readers" on public.site_mutes for select to authenticated using (public.admin_has('mutes'));

-- Отзывы: убираем прямое чтение для всех и прямую запись для администраторов (иначе можно подменить текст/автора).
drop policy if exists "public reads approved reviews" on public.reviews;
drop policy if exists "admin updates reviews" on public.reviews;
drop policy if exists "admin deletes reviews" on public.reviews;

revoke all on public.player_profiles, public.minecraft_links, public.minecraft_link_codes, public.minecraft_plugin_keys,
  public.review_replies, public.admin_profiles, public.review_reports, public.site_mutes, public.mute_audit from anon, authenticated;
revoke insert, update, delete, truncate on public.reviews from anon, authenticated;
revoke select on public.reviews from anon;
grant select on public.player_profiles, public.minecraft_links, public.mute_audit, public.site_mutes to authenticated;

-- ---------- 5. Внутренние функции ----------
create or replace function public.admin_label() returns text language sql stable as $$
  select coalesce((select public_name from public.admin_profiles where user_id = auth.uid()), auth.jwt() ->> 'email', 'admin')
$$;

-- Записывает в журнал истечение сроков, которые прошли. Вызывается при каждой проверке и при просмотре списков,
-- время события = фактический момент окончания (expires_at). Повторно запись не создаётся (уникальный индекс).
create or replace function public.sweep_expired_mutes() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into mute_audit (event_type, mute_id, user_id, target_nickname, target_mc_uuid, admin_id, admin_name, reason, duration_key, issued_at, expires_at, occurred_at)
  select 'expired', m.id, m.user_id, m.target_nickname, m.target_mc_uuid, null, 'система', m.reason, m.duration_key, m.created_at, m.expires_at, m.expires_at
  from site_mutes m
  where m.lifted_at is null and m.expires_at is not null and m.expires_at <= now()
  on conflict (mute_id) where event_type = 'expired' do nothing;
end $$;

-- Активный мут: не снят и (бессрочный или срок не истёк). Учитывает и аккаунт, и подтверждённый Minecraft UUID.
create or replace function public.active_mute_for(p_user uuid) returns public.site_mutes
language sql stable security definer set search_path = public as $$
  select m.* from site_mutes m
  where m.lifted_at is null and (m.expires_at is null or m.expires_at > now())
    and (m.user_id = p_user
         or (m.target_mc_uuid is not null and m.target_mc_uuid = (select l.mc_uuid from minecraft_links l where l.user_id = p_user)))
  order by m.expires_at desc nulls first limit 1
$$;

-- Единая серверная проверка. Любая функция, которая публикует или меняет текст игрока (отзыв, в будущем комментарий), обязана её вызвать.
create or replace function public.assert_can_publish(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m site_mutes;
begin
  perform sweep_expired_mutes();
  m := active_mute_for(p_user);
  if m.id is not null then
    raise exception 'user_muted' using detail = coalesce(to_char(m.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'permanent');
  end if;
end $$;

create or replace function public.like_escape(p text) returns text language sql immutable as $$
  select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- ---------- 6. Профиль и подтверждение аккаунта ----------
create or replace function public.save_profile(p_nickname text) returns void
language plpgsql security definer set search_path = public as $$
declare v_nick text := btrim(coalesce(p_nickname, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_nick !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'invalid_nickname'; end if;
  insert into player_profiles (user_id, nickname) values (auth.uid(), v_nick)
  on conflict (user_id) do update set nickname = excluded.nickname, updated_at = now();
end $$;

create or replace function public.my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p player_profiles; l minecraft_links; m site_mutes;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform sweep_expired_mutes();
  select * into p from player_profiles where user_id = auth.uid();
  select * into l from minecraft_links where user_id = auth.uid();
  m := active_mute_for(auth.uid());
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
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select created_at into v_recent from minecraft_link_codes where user_id = auth.uid();
  if v_recent is not null and v_recent > now() - interval '20 seconds' then raise exception 'rate_limited'; end if;
  -- байты 6 и 8 uuid v4 содержат фиксированные биты версии/варианта, их не используем
  foreach v_pos in array array[0,1,2,3,4,5,9,10] loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_pos) % 32) + 1, 1);
  end loop;
  insert into minecraft_link_codes (user_id, code_hash, expires_at)
  values (auth.uid(), sha256(convert_to(v_code, 'UTF8')), now() + interval '10 minutes')
  on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = now(), expires_at = excluded.expires_at;
  return jsonb_build_object('code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4), 'expires_at', now() + interval '10 minutes');
end $$;

-- Вызывается серверным плагином. Единственное доказательство владения: игрок реально зашёл на online-mode сервер
-- под этим аккаунтом (UUID Mojang) и ввёл в игре код, выданный ему на сайте. Ключ плагина хранится только в config.yml сервера.
-- Возвращает статус текстом: 'ok' | 'invalid_secret' | 'invalid_player' | 'invalid_code' | 'expired_code' | 'uuid_taken'.
create or replace function public.confirm_minecraft_link(p_secret text, p_code text, p_mc_uuid uuid, p_mc_name text) returns text
language plpgsql security definer set search_path = public as $$
declare v_hash bytea; v_code text; r minecraft_link_codes;
begin
  if p_secret is null or char_length(p_secret) < 32
     or not exists (select 1 from minecraft_plugin_keys where key_hash = sha256(convert_to(p_secret, 'UTF8')) and revoked_at is null) then
    return 'invalid_secret';
  end if;
  if p_mc_uuid is null or coalesce(p_mc_name, '') !~ '^[A-Za-z0-9_]{3,16}$' then return 'invalid_player'; end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  if v_code !~ '^[A-Z2-9]{8}$' then return 'invalid_code'; end if;
  select * into r from minecraft_link_codes where code_hash = sha256(convert_to(v_code, 'UTF8')) for update;
  if r.user_id is null then return 'invalid_code'; end if;
  delete from minecraft_link_codes where user_id = r.user_id; -- код одноразовый в любом исходе
  if r.expires_at <= now() then return 'expired_code'; end if;
  if exists (select 1 from minecraft_links where mc_uuid = p_mc_uuid and user_id <> r.user_id) then return 'uuid_taken'; end if;
  insert into minecraft_links (user_id, mc_uuid, mc_name) values (r.user_id, p_mc_uuid, p_mc_name)
  on conflict (user_id) do update set mc_uuid = excluded.mc_uuid, mc_name = excluded.mc_name, verified_at = now();
  return 'ok';
end $$;

create or replace function public.unlink_minecraft() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from minecraft_links where user_id = auth.uid();
  delete from minecraft_link_codes where user_id = auth.uid();
end $$;

-- ---------- 7. Публичное чтение отзывов (только безопасные поля) ----------
create or replace view public.public_reviews as
select r.id,
       coalesce(l.mc_name, r.author_name) as author_name,   -- у подтверждённых показывается ник из Minecraft
       (l.user_id is not null) as is_verified,
       r.rating, r.body, r.created_at, r.edited_at,
       rp.body as reply_body, rp.admin_public_name as reply_admin_name,
       rp.created_at as reply_created_at, rp.updated_at as reply_updated_at
from public.reviews r
left join public.minecraft_links l on l.user_id = r.user_id
left join public.review_replies rp on rp.review_id = r.id
where r.status = 'approved';

create or replace view public.public_review_stats as
select count(*)::int as total,
       coalesce(round(avg(rating), 2), 0)::numeric as average,
       (count(*) filter (where rating = 1))::int as s1, (count(*) filter (where rating = 2))::int as s2,
       (count(*) filter (where rating = 3))::int as s3, (count(*) filter (where rating = 4))::int as s4,
       (count(*) filter (where rating = 5))::int as s5
from public.reviews where status = 'approved';
grant select on public.public_reviews, public.public_review_stats to anon, authenticated;

-- ---------- 8. Отзывы игрока ----------
create or replace function public.validate_review(p_rating int, p_body text) returns text
language plpgsql immutable as $$
declare v_body text := btrim(coalesce(p_body, ''));
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'invalid_rating'; end if;
  if char_length(v_body) < 10 then raise exception 'body_too_short'; end if;
  if char_length(v_body) > 1000 then raise exception 'body_too_long'; end if;
  if v_body ~* '(https?://|www\.)' then raise exception 'links_not_allowed'; end if;
  if v_body ~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F]' then raise exception 'invalid_characters'; end if;
  return v_body;
end $$;

create or replace function public.submit_review(p_rating int, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_body text; v_nick text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_body := validate_review(p_rating, p_body);
  select nickname into v_nick from player_profiles where user_id = auth.uid();
  if v_nick is null then raise exception 'profile_required'; end if;
  perform assert_can_publish(auth.uid());
  if exists (select 1 from reviews where user_id = auth.uid()) then raise exception 'review_exists'; end if;
  if (select count(*) from reviews where created_at > now() - interval '1 minute') >= 30 then raise exception 'rate_limited'; end if;
  insert into reviews (user_id, author_name, rating, body, status) values (auth.uid(), v_nick, p_rating, v_body, 'pending')
  returning id into v_id;                      -- статус всегда pending, клиент его не передаёт
  return v_id;
end $$;

create or replace function public.edit_my_review(p_rating int, p_body text) returns text
language plpgsql security definer set search_path = public as $$
declare r reviews; v_body text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_body := validate_review(p_rating, p_body);
  select * into r from reviews where user_id = auth.uid() for update;
  if r.id is null then raise exception 'review_not_found'; end if;
  if r.status = 'hidden' then raise exception 'review_hidden'; end if;
  perform assert_can_publish(auth.uid());
  if r.rating = p_rating and r.body = v_body then return r.status; end if;
  -- любая правка возвращает отзыв на модерацию: нельзя одобрить одно и подменить текст
  update reviews set rating = p_rating, body = v_body, status = 'pending', edited_at = now(), updated_at = now(),
         moderated_by = null, moderated_at = null where id = r.id;
  return 'pending';
end $$;

-- Удаление своего отзыва разрешено всегда (в т.ч. при муте): это не публикация. Ответ и жалобы удаляются каскадом.
create or replace function public.delete_my_review() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from reviews where user_id = auth.uid();
end $$;

create or replace function public.my_review() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r reviews;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into r from reviews where user_id = auth.uid();
  if r.id is null then return null; end if;
  return jsonb_build_object('id', r.id, 'rating', r.rating, 'body', r.body, 'status', r.status,
                            'created_at', r.created_at, 'edited_at', r.edited_at);
end $$;

create or replace function public.submit_report(p_review_id uuid, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r reviews; v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_reason is null or p_reason not in ('spam','abuse','offtopic','false_info','other') then raise exception 'invalid_reason'; end if;
  if char_length(coalesce(v_details, '')) > 300 then raise exception 'details_too_long'; end if;
  select * into r from reviews where id = p_review_id and status = 'approved';
  if r.id is null then raise exception 'review_not_found'; end if;
  if r.user_id = auth.uid() then raise exception 'cannot_report_own'; end if;
  if (select count(*) from review_reports where reporter_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;
  begin
    insert into review_reports (review_id, reporter_id, reason, details) values (r.id, auth.uid(), p_reason, v_details);
  exception when unique_violation then raise exception 'already_reported';
  end;
end $$;

-- ---------- 9. Администрирование: отзывы, ответы, жалобы ----------
create or replace function public.admin_counters() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'pending_reviews', (select count(*) from reviews where status = 'pending'),
    'open_reports', (select count(*) from review_reports where status = 'open'),
    'active_mutes', (select count(*) from site_mutes where lifted_at is null and (expires_at is null or expires_at > now())));
end $$;

create or replace function public.set_admin_public_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(v) < 2 or char_length(v) > 32 or v ~ E'[<>\\x00-\\x1F]' then raise exception 'invalid_name'; end if;
  insert into admin_profiles (user_id, public_name) values (auth.uid(), v)
  on conflict (user_id) do update set public_name = excluded.public_name, updated_at = now();
end $$;

create or replace function public.get_admin_public_name() returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select public_name from admin_profiles where user_id = auth.uid());
end $$;

create or replace function public.admin_list_reviews(p_status text default 'all', p_query text default null, p_limit int default 20, p_offset int default 0)
returns table (id uuid, user_id uuid, author_name text, is_verified boolean, mc_name text, mc_uuid uuid, rating int, body text, status text,
               created_at timestamptz, edited_at timestamptz, moderated_at timestamptz,
               reply_body text, reply_admin_name text, reply_admin_id uuid, reply_created_at timestamptz, reply_updated_at timestamptz,
               open_reports int, is_muted boolean, total_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.admin_has('moderate') then raise exception 'forbidden'; end if;
  if p_status not in ('all','pending','approved','rejected','hidden') then raise exception 'invalid_status'; end if;
  perform sweep_expired_mutes();
  return query
  select r.id, r.user_id, coalesce(l.mc_name, r.author_name), (l.user_id is not null), l.mc_name, l.mc_uuid, r.rating, r.body, r.status,
         r.created_at, r.edited_at, r.moderated_at,
         rp.body, rp.admin_public_name, rp.admin_id, rp.created_at, rp.updated_at,
         (select count(*)::int from review_reports x where x.review_id = r.id and x.status = 'open'),
         (r.user_id is not null and (active_mute_for(r.user_id)).id is not null),
         count(*) over ()
  from reviews r
  left join minecraft_links l on l.user_id = r.user_id
  left join review_replies rp on rp.review_id = r.id
  where (p_status = 'all' or r.status = p_status)
    and (v_q is null or r.author_name ilike '%' || like_escape(v_q) || '%' or l.mc_name ilike '%' || like_escape(v_q) || '%'
         or r.body ilike '%' || like_escape(v_q) || '%' or r.user_id::text = v_q)
  order by (r.status = 'pending') desc, r.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_moderate_review(p_review_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_has('moderate') then raise exception 'forbidden'; end if;
  if p_status not in ('pending','approved','rejected','hidden') then raise exception 'invalid_status'; end if;
  update reviews set status = p_status, moderated_by = auth.uid(), moderated_at = now(), updated_at = now() where id = p_review_id;
  if not found then raise exception 'review_not_found'; end if;
end $$;

create or replace function public.admin_delete_review(p_review_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_has('moderate') then raise exception 'forbidden'; end if;
  delete from reviews where id = p_review_id;
  if not found then raise exception 'review_not_found'; end if;
end $$;

-- Ответ ставится только на опубликованный отзыв, автор ответа и имя берутся из JWT/таблицы на сервере.
-- Менять чужой ответ нельзя никому; удалить чужой может только полный администратор.
create or replace function public.admin_reply_review(p_review_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare v_body text := btrim(coalesce(p_body, '')); v_status text; e review_replies;
begin
  if not public.admin_has('moderate') then raise exception 'forbidden'; end if;
  if char_length(v_body) < 1 then raise exception 'reply_empty'; end if;
  if char_length(v_body) > 1000 then raise exception 'reply_too_long'; end if;
  select status into v_status from reviews where id = p_review_id for update;
  if v_status is null then raise exception 'review_not_found'; end if;
  if v_status <> 'approved' then raise exception 'review_not_published'; end if;
  select * into e from review_replies where review_id = p_review_id;
  if e.review_id is null then
    insert into review_replies (review_id, body, admin_id, admin_public_name)
    values (p_review_id, v_body, auth.uid(), coalesce((select public_name from admin_profiles where user_id = auth.uid()), 'Администрация'));
  elsif e.admin_id <> auth.uid() then raise exception 'not_reply_author';
  elsif e.body <> v_body then
    update review_replies set body = v_body, updated_at = now() where review_id = p_review_id;
  end if;
end $$;

create or replace function public.admin_delete_reply(p_review_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e review_replies;
begin
  if not public.admin_has('moderate') then raise exception 'forbidden'; end if;
  select * into e from review_replies where review_id = p_review_id;
  if e.review_id is null then raise exception 'reply_not_found'; end if;
  if e.admin_id <> auth.uid() and not public.admin_full() then raise exception 'not_reply_author'; end if;
  delete from review_replies where review_id = p_review_id;
end $$;

create or replace function public.admin_list_reports(p_status text default 'open', p_limit int default 30, p_offset int default 0)
returns table (id uuid, review_id uuid, review_body text, review_author text, review_status text, reason text, details text, status text,
               created_at timestamptz, reporter_nickname text, resolved_at timestamptz, resolution_note text, total_count bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_has('moderate') then raise exception 'forbidden'; end if;
  if p_status not in ('all','open','resolved','dismissed') then raise exception 'invalid_status'; end if;
  return query
  select x.id, x.review_id, r.body, coalesce(l.mc_name, r.author_name), r.status, x.reason, x.details, x.status, x.created_at,
         pp.nickname, x.resolved_at, x.resolution_note, count(*) over ()
  from review_reports x
  join reviews r on r.id = x.review_id
  left join minecraft_links l on l.user_id = r.user_id
  left join player_profiles pp on pp.user_id = x.reporter_id
  where p_status = 'all' or x.status = p_status
  order by (x.status = 'open') desc, x.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_resolve_report(p_report_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.admin_has('moderate') then raise exception 'forbidden'; end if;
  if p_status not in ('resolved','dismissed') then raise exception 'invalid_status'; end if;
  if char_length(coalesce(v_note, '')) > 300 then raise exception 'note_too_long'; end if;
  update review_reports set status = p_status, resolved_by = auth.uid(), resolved_at = now(), resolution_note = v_note
  where id = p_report_id and status = 'open';
  if not found then raise exception 'report_not_open'; end if;
end $$;

-- ---------- 10. Муты ----------
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
  select u.id, p.nickname, l.mc_name, l.mc_uuid, (l.user_id is not null), l.verified_at,
         left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2),
         u.created_at,
         (am.id is not null), am.expires_at, (am.id is not null and am.expires_at is null)
  from auth.users u
  left join player_profiles p on p.user_id = u.id
  left join minecraft_links l on l.user_id = u.id
  left join lateral (select (active_mute_for(u.id)).*) am on true
  where p.nickname ilike '%' || like_escape(v_q) || '%' or l.mc_name ilike '%' || like_escape(v_q) || '%'
     or u.id::text = v_q or l.mc_uuid::text = v_q or u.email ilike like_escape(v_q) || '%'
  order by p.nickname nulls last
  limit 50;
end $$;

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
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then raise exception 'user_not_found'; end if;
  if p_user_id = auth.uid() then raise exception 'cannot_mute_self'; end if;
  if exists (select 1 from auth.users where id = p_user_id and raw_app_meta_data ->> 'role' = 'admin') then raise exception 'cannot_mute_admin'; end if;
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

create or replace function public.admin_lift_mute(p_mute_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m site_mutes; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_name text := public.admin_label();
begin
  if not public.admin_has('mutes') then raise exception 'forbidden'; end if;
  if char_length(coalesce(v_reason, '')) > 300 then raise exception 'reason_too_long'; end if;
  perform sweep_expired_mutes();
  select * into m from site_mutes where id = p_mute_id for update;
  if m.id is null then raise exception 'mute_not_found'; end if;
  if m.user_id = auth.uid() then raise exception 'cannot_lift_own_mute'; end if;
  if m.lifted_at is not null or (m.expires_at is not null and m.expires_at <= now()) then raise exception 'mute_not_active'; end if;
  update site_mutes set lifted_at = now(), lifted_by = auth.uid(), lifted_by_name = v_name, lift_reason = v_reason where id = m.id;
  insert into mute_audit (event_type, mute_id, user_id, target_nickname, target_mc_uuid, admin_id, admin_name, reason, duration_key, issued_at, expires_at, lift_reason, occurred_at)
  values ('lifted', m.id, m.user_id, m.target_nickname, m.target_mc_uuid, auth.uid(), v_name, m.reason, m.duration_key, m.created_at, m.expires_at, v_reason, now());
end $$;

create or replace function public.admin_list_mutes(p_status text default 'all', p_query text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, user_id uuid, target_nickname text, target_mc_name text, target_mc_uuid uuid, issued_by_name text, reason text,
               duration_key text, created_at timestamptz, expires_at timestamptz, lifted_at timestamptz, lifted_by_name text, lift_reason text,
               status text, remaining_seconds bigint, total_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.admin_has('mutes') then raise exception 'forbidden'; end if;
  if p_status not in ('all','active','expired','lifted') then raise exception 'invalid_status'; end if;
  perform sweep_expired_mutes();
  return query
  select t.id, t.user_id, t.target_nickname, t.target_mc_name, t.target_mc_uuid, t.issued_by_name, t.reason, t.duration_key,
         t.created_at, t.expires_at, t.lifted_at, t.lifted_by_name, t.lift_reason, t.st, t.rem, count(*) over ()
  from (
    select m.*,
           (case when m.lifted_at is not null then 'lifted' when m.expires_at is not null and m.expires_at <= now() then 'expired' else 'active' end)::text as st,
           (case when m.lifted_at is null and m.expires_at is not null and m.expires_at > now()
                 then ceil(extract(epoch from m.expires_at - now()))::bigint end) as rem
    from site_mutes m
    where v_q is null or m.target_nickname ilike '%' || like_escape(v_q) || '%' or m.target_mc_name ilike '%' || like_escape(v_q) || '%'
       or m.reason ilike '%' || like_escape(v_q) || '%' or m.user_id::text = v_q or m.target_mc_uuid::text = v_q
  ) t
  where p_status = 'all' or t.st = p_status
  order by (t.st = 'active') desc, t.created_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- ---------- 11. Журнал наказаний (только право 'audit') ----------
create or replace function public.admin_audit_log(p_event text default 'all', p_query text default null, p_limit int default 50, p_offset int default 0)
returns table (id bigint, event_type text, mute_id uuid, user_id uuid, target_nickname text, target_mc_uuid uuid, admin_name text, reason text,
               duration_key text, issued_at timestamptz, expires_at timestamptz, lift_reason text, occurred_at timestamptz, total_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.admin_has('audit') then raise exception 'forbidden'; end if;
  if p_event not in ('all','issued','expired','lifted') then raise exception 'invalid_status'; end if;
  perform sweep_expired_mutes();
  return query
  select a.id, a.event_type, a.mute_id, a.user_id, a.target_nickname, a.target_mc_uuid, a.admin_name, a.reason, a.duration_key,
         a.issued_at, a.expires_at, a.lift_reason, a.occurred_at, count(*) over ()
  from mute_audit a
  where (p_event = 'all' or a.event_type = p_event)
    and (v_q is null or a.target_nickname ilike '%' || like_escape(v_q) || '%' or a.admin_name ilike '%' || like_escape(v_q) || '%'
         or a.reason ilike '%' || like_escape(v_q) || '%' or a.user_id::text = v_q or a.target_mc_uuid::text = v_q)
  order by a.occurred_at desc, a.id desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- ---------- 12. Права на выполнение функций ----------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any(array[
    'admin_label','sweep_expired_mutes','active_mute_for','assert_can_publish','like_escape','validate_review',
    'save_profile','my_account','create_link_code','confirm_minecraft_link','unlink_minecraft',
    'submit_review','edit_my_review','delete_my_review','my_review','submit_report',
    'admin_counters','set_admin_public_name','get_admin_public_name','admin_list_reviews','admin_moderate_review',
    'admin_delete_review','admin_reply_review','admin_delete_reply','admin_list_reports','admin_resolve_report',
    'admin_search_players','admin_issue_mute','admin_lift_mute','admin_list_mutes','admin_audit_log'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Игрок (вошедший пользователь)
grant execute on function public.save_profile(text), public.my_account(), public.create_link_code(), public.unlink_minecraft(),
  public.submit_review(int, text), public.edit_my_review(int, text), public.delete_my_review(), public.my_review(),
  public.submit_report(uuid, text, text) to authenticated;
-- Серверный плагин вызывает с anon-ключом + собственным секретом
grant execute on function public.confirm_minecraft_link(text, text, uuid, text) to anon, authenticated;
-- Администраторы: роль и права проверяются внутри каждой функции
grant execute on function public.admin_counters(), public.set_admin_public_name(text), public.get_admin_public_name(),
  public.admin_list_reviews(text, text, int, int), public.admin_moderate_review(uuid, text), public.admin_delete_review(uuid),
  public.admin_reply_review(uuid, text), public.admin_delete_reply(uuid), public.admin_list_reports(text, int, int),
  public.admin_resolve_report(uuid, text, text), public.admin_search_players(text), public.admin_issue_mute(uuid, text, text),
  public.admin_lift_mute(uuid, text), public.admin_list_mutes(text, text, int, int), public.admin_audit_log(text, text, int, int)
  to authenticated;
