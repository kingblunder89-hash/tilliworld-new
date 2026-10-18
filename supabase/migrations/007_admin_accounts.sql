-- Tilliworld: миграция 007 — управление аккаунтами игроков для администраторов. Применять ПОСЛЕ 004 и 006. Повторный запуск безопасен.
--
-- Права (как в 004, ключ app_metadata.permissions; без ключа права полные):
--   просмотр списка и карточки аккаунта: 'accounts' или 'mutes' или 'moderate';
--   сброс пароля, завершение сессий, отвязка Minecraft, удаление аккаунта, журнал действий: 'accounts'.
-- Пароли хранятся только как bcrypt и администратору не показываются: пароль можно лишь заменить на новый.
-- Каждое действие над аккаунтом пишется в неизменяемый журнал account_actions.

create table if not exists public.account_actions (
  id bigint generated always as identity primary key,
  action text not null check (action in ('password_reset','sessions_revoked','minecraft_unlinked','account_deleted')),
  player_id uuid not null,                 -- без внешнего ключа: запись переживает удаление аккаунта
  player_nickname text not null,
  admin_id uuid not null,
  admin_name text not null,
  note text,
  occurred_at timestamptz not null default now()
);
create index if not exists account_actions_player on public.account_actions (player_id, occurred_at desc);
create index if not exists account_actions_time on public.account_actions (occurred_at desc);
alter table public.account_actions enable row level security;
revoke all on public.account_actions from anon, authenticated;

drop trigger if exists account_actions_no_change on public.account_actions;
create trigger account_actions_no_change before update or delete on public.account_actions
  for each row execute function public.mute_audit_immutable();
drop trigger if exists account_actions_no_truncate on public.account_actions;
create trigger account_actions_no_truncate before truncate on public.account_actions
  for each statement execute function public.mute_audit_immutable();

create or replace function public.log_account_action(p_action text, p_player uuid, p_nick text, p_note text default null) returns void
language sql security definer set search_path = public as $$
  insert into account_actions (action, player_id, player_nickname, admin_id, admin_name, note)
  values (p_action, p_player, p_nick, auth.uid(), public.admin_label(), p_note)
$$;

-- Список аккаунтов: фильтры all | verified | unverified | muted; поиск по нику, Minecraft-нику, UUID, id.
create or replace function public.admin_list_accounts(p_filter text default 'all', p_query text default null, p_limit int default 20, p_offset int default 0)
returns table (id uuid, nickname text, created_at timestamptz, verified boolean, mc_name text, mc_uuid uuid, verified_at timestamptz,
               review_status text, is_muted boolean, mute_expires_at timestamptz, mute_permanent boolean, last_session_at timestamptz, total_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not (public.admin_has('accounts') or public.admin_has('mutes') or public.admin_has('moderate')) then raise exception 'forbidden'; end if;
  if p_filter not in ('all','verified','unverified','muted') then raise exception 'invalid_status'; end if;
  if v_q is not null and char_length(v_q) < 2 then raise exception 'query_too_short'; end if;
  perform sweep_expired_mutes();
  return query
  select t.id, t.nickname, t.created_at, t.verified, t.mc_name, t.mc_uuid, t.verified_at, t.review_status,
         t.is_muted, t.mute_expires_at, t.mute_permanent, t.last_session_at, count(*) over ()
  from (
    select a.id, a.nickname, a.created_at, (l.user_id is not null) as verified, l.mc_name, l.mc_uuid, l.verified_at,
           (select r.status from reviews r where r.user_id = a.id) as review_status,
           (am.id is not null) as is_muted, am.expires_at as mute_expires_at, (am.id is not null and am.expires_at is null) as mute_permanent,
           (select max(s.created_at) from player_sessions s where s.player_id = a.id) as last_session_at
    from player_accounts a
    left join minecraft_links l on l.user_id = a.id
    left join lateral (select (active_mute_for(a.id)).*) am on true
    where v_q is null or a.nickname ilike '%' || like_escape(v_q) || '%' or l.mc_name ilike '%' || like_escape(v_q) || '%'
       or a.id::text = v_q or l.mc_uuid::text = v_q
  ) t
  where p_filter = 'all' or (p_filter = 'verified' and t.verified) or (p_filter = 'unverified' and not t.verified) or (p_filter = 'muted' and t.is_muted)
  order by t.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

-- Карточка аккаунта. Хэш пароля и токены сессий сюда не попадают.
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

-- Новый пароль задаёт администратор (старый узнать нельзя). Все сессии игрока завершаются, блокировка входа по неудачам снимается.
create or replace function public.admin_reset_player_password(p_id uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a player_accounts;
begin
  if not public.admin_has('accounts') then raise exception 'forbidden'; end if;
  if p_password is null or char_length(p_password) < 8 then raise exception 'password_too_short'; end if;
  if char_length(p_password) > 72 then raise exception 'password_too_long'; end if;
  select * into a from player_accounts where id = p_id for update;
  if a.id is null then raise exception 'player_not_found'; end if;
  update player_accounts set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)) where id = a.id;
  delete from player_sessions where player_id = a.id;
  delete from player_login_failures where nickname_lower = a.nickname_lower;
  perform public.log_account_action('password_reset', a.id, a.nickname);
end $$;

create or replace function public.admin_revoke_player_sessions(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare a player_accounts; n int;
begin
  if not public.admin_has('accounts') then raise exception 'forbidden'; end if;
  select * into a from player_accounts where id = p_id;
  if a.id is null then raise exception 'player_not_found'; end if;
  delete from player_sessions where player_id = a.id;
  get diagnostics n = row_count;
  perform public.log_account_action('sessions_revoked', a.id, a.nickname, n || ' сессий');
  return n;
end $$;

-- Отвязка не снимает мут: он хранит UUID отдельно.
create or replace function public.admin_unlink_player_minecraft(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a player_accounts; l minecraft_links;
begin
  if not public.admin_has('accounts') then raise exception 'forbidden'; end if;
  select * into a from player_accounts where id = p_id;
  if a.id is null then raise exception 'player_not_found'; end if;
  select * into l from minecraft_links where user_id = a.id;
  if l.user_id is null then raise exception 'not_linked'; end if;
  delete from minecraft_links where user_id = a.id;
  delete from minecraft_link_codes where user_id = a.id;
  perform public.log_account_action('minecraft_unlinked', a.id, a.nickname, l.mc_name || ' (' || l.mc_uuid || ')');
end $$;

-- Удаление необратимо. Ник нужно ввести полностью (защита от ошибочного клика). Мут и журнал наказаний остаются.
create or replace function public.admin_delete_player(p_id uuid, p_nickname text, p_delete_reviews boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare a player_accounts; v_reviews int := 0;
begin
  if not public.admin_has('accounts') then raise exception 'forbidden'; end if;
  select * into a from player_accounts where id = p_id for update;
  if a.id is null then raise exception 'player_not_found'; end if;
  if lower(btrim(coalesce(p_nickname, ''))) <> a.nickname_lower then raise exception 'nickname_mismatch'; end if;
  if p_delete_reviews then
    delete from reviews where user_id = a.id;
    get diagnostics v_reviews = row_count;
  end if;
  perform public.log_account_action('account_deleted', a.id, a.nickname,
    case when p_delete_reviews then 'отзывы удалены: ' || v_reviews else 'отзыв сохранён как старый' end);
  delete from player_accounts where id = a.id;
end $$;

create or replace function public.admin_account_actions(p_query text default null, p_limit int default 50, p_offset int default 0)
returns table (id bigint, action text, player_id uuid, player_nickname text, admin_name text, note text, occurred_at timestamptz, total_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not (public.admin_has('accounts') or public.admin_has('audit')) then raise exception 'forbidden'; end if;
  return query
  select x.id, x.action, x.player_id, x.player_nickname, x.admin_name, x.note, x.occurred_at, count(*) over ()
  from account_actions x
  where v_q is null or x.player_nickname ilike '%' || like_escape(v_q) || '%' or x.admin_name ilike '%' || like_escape(v_q) || '%' or x.player_id::text = v_q
  order by x.occurred_at desc, x.id desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('log_account_action','admin_list_accounts','admin_account_detail','admin_reset_player_password',
             'admin_revoke_player_sessions','admin_unlink_player_minecraft','admin_delete_player','admin_account_actions')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
grant execute on function public.admin_list_accounts(text, text, int, int), public.admin_account_detail(uuid),
  public.admin_reset_player_password(uuid, text), public.admin_revoke_player_sessions(uuid), public.admin_unlink_player_minecraft(uuid),
  public.admin_delete_player(uuid, text, boolean), public.admin_account_actions(text, int, int) to authenticated;
