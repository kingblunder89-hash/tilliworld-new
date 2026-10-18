-- Tilliworld: миграция 008 — ручное подтверждение регистрации администратором. Применять ПОСЛЕ 006 и 007. Повторный запуск безопасен.
--
-- ПО УМОЛЧАНИЮ РУЧНОЕ ПОДТВЕРЖДЕНИЕ ВЫКЛЮЧЕНО: регистрация по нику и паролю работает мгновенно, как раньше.
-- Включить: update public.registration_settings set require_approval = true;   Выключить: ... = false;
--
-- Когда включено: новый аккаунт создаётся в статусе 'pending' и сессию не получает. Войти можно только после того, как
-- администратор (право 'accounts') нажмёт «Одобрить» в разделе «Аккаунты». Отклонённый аккаунт ('rejected') войти не может,
-- ник остаётся занятым; администратор может позже одобрить его или удалить. Все аккаунты, созданные до миграции, считаются одобренными.

create table if not exists public.registration_settings (
  id boolean primary key default true check (id),
  require_approval boolean not null default false
);
insert into public.registration_settings (id) values (true) on conflict do nothing;
alter table public.registration_settings enable row level security;
revoke all on public.registration_settings from anon, authenticated;

alter table public.player_accounts add column if not exists approval_status text not null default 'approved';
alter table public.player_accounts alter column approval_status set default 'pending';
alter table public.player_accounts drop constraint if exists player_accounts_approval_status_check;
alter table public.player_accounts add constraint player_accounts_approval_status_check check (approval_status in ('pending','approved','rejected'));
alter table public.player_accounts add column if not exists decided_at timestamptz;
alter table public.player_accounts add column if not exists decided_by_name text;
alter table public.player_accounts add column if not exists reject_reason text;
create index if not exists player_accounts_pending on public.player_accounts (created_at) where approval_status = 'pending';

alter table public.account_actions drop constraint if exists account_actions_action_check;
alter table public.account_actions add constraint account_actions_action_check
  check (action in ('password_reset','sessions_revoked','minecraft_unlinked','account_deleted','account_approved','account_rejected'));

-- Игрок определяется по токену только если аккаунт одобрен (на случай, если сессия осталась от отклонённого аккаунта).
create or replace function public.player_uid() returns uuid
language sql stable security definer set search_path = public as $$
  select s.player_id from player_sessions s join player_accounts a on a.id = s.player_id
  where s.token_hash = public.player_token_hash() and s.expires_at > now() and a.approval_status = 'approved'
$$;

-- Регистрация: при require_approval аккаунт создаётся без токена (статус 'pending_approval'), иначе игрок сразу входит.
create or replace function public.player_register(p_nickname text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_nick text := btrim(coalesce(p_nickname, '')); v_id uuid; v_req boolean := (select require_approval from registration_settings);
begin
  if v_nick !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'invalid_nickname'; end if;
  if p_password is null or char_length(p_password) < 8 then raise exception 'password_too_short'; end if;
  if char_length(p_password) > 72 then raise exception 'password_too_long'; end if;
  if (select count(*) from player_accounts where created_at > now() - interval '1 minute') >= 30 then raise exception 'rate_limited'; end if;
  if (select count(*) from player_accounts where approval_status = 'pending') >= 500 then raise exception 'too_many_pending'; end if;
  insert into player_accounts (nickname, password_hash, approval_status) values (v_nick, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), case when v_req then 'pending' else 'approved' end)
  on conflict (nickname_lower) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('status', 'nick_taken'); end if;
  insert into player_profiles (user_id, nickname) values (v_id, v_nick);
  if v_req then return jsonb_build_object('status', 'pending_approval', 'nickname', v_nick); end if;
  return jsonb_build_object('status', 'ok', 'token', public.create_player_session(v_id), 'nickname', v_nick);
end $$;

-- Вход: статус ожидания/отклонения показывается только после проверки пароля, чужой ник статус не узнает.
create or replace function public.player_login(p_nickname text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_lower text := lower(btrim(coalesce(p_nickname, ''))); a player_accounts; v_ok boolean;
begin
  if (select count(*) from player_login_failures where nickname_lower = v_lower and at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;
  select * into a from player_accounts where nickname_lower = v_lower;
  if a.id is null then
    perform extensions.crypt(coalesce(p_password, ''), '$2a$10$7EqJtq98hPqEX7fNZaFWoOhi5BUk8Xg5y0h0A7P2U8bQe0S3p0n2u');
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
  if a.approval_status = 'pending' then return jsonb_build_object('status', 'pending_approval', 'nickname', a.nickname); end if;
  if a.approval_status = 'rejected' then return jsonb_build_object('status', 'rejected', 'reason', a.reject_reason); end if;
  return jsonb_build_object('status', 'ok', 'token', public.create_player_session(a.id), 'nickname', a.nickname);
end $$;

-- Счётчик для навигации админки.
create or replace function public.admin_counters() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'pending_reviews', (select count(*) from reviews where status = 'pending'),
    'open_reports', (select count(*) from review_reports where status = 'open'),
    'active_mutes', (select count(*) from site_mutes where lifted_at is null and (expires_at is null or expires_at > now())),
    'pending_accounts', (select count(*) from player_accounts where approval_status = 'pending'));
end $$;

-- Список аккаунтов: добавлен фильтр 'pending' (ожидают) и поле approval_status.
drop function if exists public.admin_list_accounts(text, text, int, int);
create function public.admin_list_accounts(p_filter text default 'all', p_query text default null, p_limit int default 20, p_offset int default 0)
returns table (id uuid, nickname text, created_at timestamptz, verified boolean, mc_name text, mc_uuid uuid, verified_at timestamptz,
               review_status text, is_muted boolean, mute_expires_at timestamptz, mute_permanent boolean, last_session_at timestamptz,
               approval_status text, total_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not (public.admin_has('accounts') or public.admin_has('mutes') or public.admin_has('moderate')) then raise exception 'forbidden'; end if;
  if p_filter not in ('all','pending','rejected','verified','unverified','muted') then raise exception 'invalid_status'; end if;
  if v_q is not null and char_length(v_q) < 2 then raise exception 'query_too_short'; end if;
  perform sweep_expired_mutes();
  return query
  select t.id, t.nickname, t.created_at, t.verified, t.mc_name, t.mc_uuid, t.verified_at, t.review_status,
         t.is_muted, t.mute_expires_at, t.mute_permanent, t.last_session_at, t.approval_status, count(*) over ()
  from (
    select a.id, a.nickname, a.created_at, (l.user_id is not null) as verified, l.mc_name, l.mc_uuid, l.verified_at,
           (select r.status from reviews r where r.user_id = a.id) as review_status,
           (am.id is not null) as is_muted, am.expires_at as mute_expires_at, (am.id is not null and am.expires_at is null) as mute_permanent,
           (select max(s.created_at) from player_sessions s where s.player_id = a.id) as last_session_at,
           a.approval_status
    from player_accounts a
    left join minecraft_links l on l.user_id = a.id
    left join lateral (select (active_mute_for(a.id)).*) am on true
    where v_q is null or a.nickname ilike '%' || like_escape(v_q) || '%' or l.mc_name ilike '%' || like_escape(v_q) || '%'
       or a.id::text = v_q or l.mc_uuid::text = v_q
  ) t
  where p_filter = 'all' or (p_filter = 'pending' and t.approval_status = 'pending') or (p_filter = 'rejected' and t.approval_status = 'rejected')
     or (p_filter = 'verified' and t.verified) or (p_filter = 'unverified' and not t.verified) or (p_filter = 'muted' and t.is_muted)
  order by (t.approval_status = 'pending') desc, t.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

-- Карточка: к прежним полям добавляется статус подтверждения регистрации.
create or replace function public.admin_account_detail(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a player_accounts; l minecraft_links; r reviews;
begin
  if not (public.admin_has('accounts') or public.admin_has('mutes') or public.admin_has('moderate')) then raise exception 'forbidden'; end if;
  select * into a from player_accounts where id = p_id;
  if a.id is null then raise exception 'player_not_found'; end if;
  perform sweep_expired_mutes();
  select * into l from minecraft_links where user_id = a.id;
  select * into r from reviews where user_id = a.id;
  return jsonb_build_object(
    'id', a.id, 'nickname', a.nickname, 'created_at', a.created_at,
    'approval', jsonb_build_object('status', a.approval_status, 'decided_at', a.decided_at, 'decided_by_name', a.decided_by_name, 'reject_reason', a.reject_reason),
    'minecraft', case when l.user_id is null then null else jsonb_build_object('mc_name', l.mc_name, 'mc_uuid', l.mc_uuid, 'verified_at', l.verified_at) end,
    'sessions', jsonb_build_object('count', (select count(*) from player_sessions s where s.player_id = a.id and s.expires_at > now()),
                                   'last_at', (select max(s.created_at) from player_sessions s where s.player_id = a.id)),
    'review', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'rating', r.rating, 'body', r.body, 'created_at', r.created_at, 'edited_at', r.edited_at) end,
    'reports_filed', (select count(*) from review_reports x where x.reporter_id = a.id),
    'reports_against', (select count(*) from review_reports x join reviews rv on rv.id = x.review_id where rv.user_id = a.id),
    'mutes', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'reason', m.reason, 'duration_key', m.duration_key, 'created_at', m.created_at,
                'expires_at', m.expires_at, 'lifted_at', m.lifted_at, 'issued_by_name', m.issued_by_name,
                'status', case when m.lifted_at is not null then 'lifted' when m.expires_at is not null and m.expires_at <= now() then 'expired' else 'active' end)
                order by m.created_at desc) from (select * from site_mutes where user_id = a.id order by created_at desc limit 20) m), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('action', x.action, 'admin_name', x.admin_name, 'note', x.note, 'occurred_at', x.occurred_at)
                order by x.occurred_at desc) from (select * from account_actions where player_id = a.id order by occurred_at desc limit 20) x), '[]'::jsonb));
end $$;

-- Одобрить регистрацию (из ожидания или после отклонения).
create or replace function public.admin_approve_player(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a player_accounts;
begin
  if not public.admin_has('accounts') then raise exception 'forbidden'; end if;
  select * into a from player_accounts where id = p_id for update;
  if a.id is null then raise exception 'player_not_found'; end if;
  if a.approval_status = 'approved' then raise exception 'already_approved'; end if;
  update player_accounts set approval_status = 'approved', decided_at = now(), decided_by_name = public.admin_label(), reject_reason = null where id = a.id;
  perform public.log_account_action('account_approved', a.id, a.nickname);
end $$;

-- Отклонить регистрацию: причина обязательна, показывается игроку при попытке входа. Сессии завершаются.
create or replace function public.admin_reject_player(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a player_accounts; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.admin_has('accounts') then raise exception 'forbidden'; end if;
  if char_length(v_reason) < 3 then raise exception 'reason_required'; end if;
  if char_length(v_reason) > 300 then raise exception 'reason_too_long'; end if;
  select * into a from player_accounts where id = p_id for update;
  if a.id is null then raise exception 'player_not_found'; end if;
  if a.approval_status = 'rejected' then raise exception 'already_rejected'; end if;
  update player_accounts set approval_status = 'rejected', decided_at = now(), decided_by_name = public.admin_label(), reject_reason = v_reason where id = a.id;
  delete from player_sessions where player_id = a.id;
  perform public.log_account_action('account_rejected', a.id, a.nickname, v_reason);
end $$;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('player_uid','player_register','player_login','admin_counters','admin_list_accounts',
             'admin_account_detail','admin_approve_player','admin_reject_player')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
grant execute on function public.player_register(text, text), public.player_login(text, text) to anon, authenticated;
grant execute on function public.admin_counters(), public.admin_list_accounts(text, text, int, int), public.admin_account_detail(uuid),
  public.admin_approve_player(uuid), public.admin_reject_player(uuid, text) to authenticated;
