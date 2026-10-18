-- Tilliworld: миграция 009 — внутренняя экономика сайта (виртуальные монеты) и колесо удачи.
-- Применять ПОСЛЕ 006, 007 и 008. Повторный запуск безопасен (данные не затираются).
--
-- Это отдельная система: она НЕ связана с EssentialsX, Vault и игровым балансом Minecraft.
-- Принципы:
--   * Баланс и журнал меняются только внутренней функцией economy_apply() в одной транзакции (строка баланса блокируется FOR UPDATE).
--     У anon/authenticated нет прямого доступа к таблицам, а economy_apply им недоступна: клиент не может изменить баланс.
--   * Журнал economy_transactions неизменяем (триггеры запрещают UPDATE/DELETE/TRUNCATE), баланс не может быть отрицательным.
--   * Будущий магазин вызывает economy_apply(игрок, -цена, 'purchase', ...) внутри своей функции покупки: отдельная таблица не нужна.
--   * Права администратора: ключ 'economy' в app_metadata.permissions (администраторы без ключа permissions имеют полный доступ).
-- Вероятности хранятся в сотых долях процента (basis points): 10000 = 100%, сумма проверяется на точное равенство.

-- ---------- Таблицы ----------
create table if not exists public.player_balances (
  player_id uuid primary key references public.player_accounts(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0 and balance <= 1000000000000),
  updated_at timestamptz not null default now()
);

create table if not exists public.economy_transactions (
  id bigint generated always as identity primary key,
  player_id uuid not null,                       -- без внешнего ключа: журнал переживает удаление аккаунта
  player_nickname text not null,
  kind text not null check (kind in ('wheel_win','admin_credit','admin_debit','purchase','refund')),
  amount bigint not null check (amount <> 0),    -- со знаком: + начисление, − списание
  balance_after bigint not null check (balance_after >= 0),
  reason text not null,
  ref_type text,                                 -- например 'wheel_spin' (позже 'shop_order')
  ref_id uuid,
  admin_id uuid,
  admin_name text,
  created_at timestamptz not null default now()
);
create index if not exists economy_tx_player on public.economy_transactions (player_id, created_at desc, id desc);
create index if not exists economy_tx_time on public.economy_transactions (created_at desc, id desc);

create table if not exists public.wheel_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  cooldown_hours int not null default 24 check (cooldown_hours between 1 and 168),
  updated_at timestamptz not null default now()
);
insert into public.wheel_settings (id) values (true) on conflict do nothing;

create table if not exists public.wheel_prizes (
  id int generated always as identity primary key,
  position int not null,
  amount bigint not null check (amount between 1 and 1000000000),
  chance_bp int not null check (chance_bp between 1 and 10000)
);
insert into public.wheel_prizes (position, amount, chance_bp)
select * from (values (1, 50, 3500), (2, 100, 2500), (3, 250, 2000), (4, 500, 1200), (5, 1000, 700), (6, 2500, 100)) v
where not exists (select 1 from public.wheel_prizes);

create table if not exists public.wheel_spins (
  id uuid primary key,
  player_id uuid not null,                       -- без внешнего ключа: история переживает удаление аккаунта
  player_nickname text not null,
  prize_amount bigint not null,
  chance_bp int not null,
  status text not null default 'completed' check (status in ('completed')),
  tx_id bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists wheel_spins_player on public.wheel_spins (player_id, created_at desc);
create index if not exists wheel_spins_time on public.wheel_spins (created_at desc);

create table if not exists public.economy_admin_log (
  id bigint generated always as identity primary key,
  action text not null check (action in ('wheel_enabled','wheel_disabled','prizes_changed')),
  details jsonb,
  admin_id uuid not null,
  admin_name text not null,
  occurred_at timestamptz not null default now()
);

alter table public.player_balances enable row level security;
alter table public.economy_transactions enable row level security;
alter table public.wheel_settings enable row level security;
alter table public.wheel_prizes enable row level security;
alter table public.wheel_spins enable row level security;
alter table public.economy_admin_log enable row level security;
revoke all on public.player_balances, public.economy_transactions, public.wheel_settings, public.wheel_prizes, public.wheel_spins, public.economy_admin_log from anon, authenticated;

-- Журналы неизменяемы (используется общий триггер из 004).
do $$
declare t text;
begin
  foreach t in array array['economy_transactions','wheel_spins','economy_admin_log'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_change', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.mute_audit_immutable()', t || '_no_change', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.mute_audit_immutable()', t || '_no_truncate', t);
  end loop;
end $$;

-- ---------- Баланс 0 при создании аккаунта ----------
create or replace function public.create_player_balance() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into player_balances (player_id, balance) values (new.id, 0) on conflict do nothing; return new; end $$;
drop trigger if exists player_accounts_balance on public.player_accounts;
create trigger player_accounts_balance after insert on public.player_accounts for each row execute function public.create_player_balance();
insert into public.player_balances (player_id) select id from public.player_accounts on conflict do nothing;   -- уже существующие аккаунты

-- ---------- Единственная точка изменения баланса ----------
-- Недоступна клиентам. Блокирует строку баланса, проверяет границы, пишет журнал и баланс в одной транзакции.
create or replace function public.economy_apply(p_player uuid, p_amount bigint, p_kind text, p_reason text,
  p_ref_type text default null, p_ref_id uuid default null, p_admin_id uuid default null, p_admin_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bal bigint; v_new bigint; v_nick text; v_tx bigint;
begin
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000 then raise exception 'invalid_amount'; end if;
  select nickname into v_nick from player_accounts where id = p_player;
  if v_nick is null then raise exception 'player_not_found'; end if;
  select balance into v_bal from player_balances where player_id = p_player for update;
  if v_bal is null then
    insert into player_balances (player_id) values (p_player) on conflict do nothing;
    select balance into v_bal from player_balances where player_id = p_player for update;
  end if;
  v_new := v_bal + p_amount;
  if v_new < 0 then raise exception 'insufficient_funds'; end if;
  if v_new > 1000000000000 then raise exception 'balance_overflow'; end if;
  update player_balances set balance = v_new, updated_at = now() where player_id = p_player;
  insert into economy_transactions (player_id, player_nickname, kind, amount, balance_after, reason, ref_type, ref_id, admin_id, admin_name)
  values (p_player, v_nick, p_kind, p_amount, v_new, p_reason, p_ref_type, p_ref_id, p_admin_id, p_admin_name) returning id into v_tx;
  return jsonb_build_object('tx_id', v_tx, 'balance', v_new);
end $$;

-- ---------- Игрок ----------
create or replace function public.wheel_next_spin_at(p_player uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select (select max(s.created_at) from wheel_spins s where s.player_id = p_player) + make_interval(hours => (select cooldown_hours from wheel_settings))
$$;

create or replace function public.economy_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.player_uid(); w wheel_settings; v_next timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into w from wheel_settings;
  v_next := public.wheel_next_spin_at(v_uid);
  return jsonb_build_object(
    'balance', coalesce((select balance from player_balances where player_id = v_uid), 0),
    'server_now', now(),
    'wheel', jsonb_build_object(
      'enabled', w.enabled, 'cooldown_hours', w.cooldown_hours,
      'next_spin_at', case when v_next is not null and v_next > now() then v_next else null end,
      'can_spin', w.enabled and (v_next is null or v_next <= now()),
      'prizes', coalesce((select jsonb_agg(jsonb_build_object('amount', amount, 'chance_bp', chance_bp) order by position, id) from wheel_prizes), '[]'::jsonb)));
end $$;

create or replace function public.my_transactions(p_limit int default 20, p_offset int default 0)
returns table (id bigint, kind text, amount bigint, balance_after bigint, reason text, created_at timestamptz, total_count bigint)
language plpgsql security definer set search_path = public as $$
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  return query
  select t.id, t.kind, t.amount, t.balance_after, t.reason, t.created_at, count(*) over ()
  from economy_transactions t where t.player_id = public.player_uid()
  order by t.created_at desc, t.id desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create or replace function public.my_spins(p_limit int default 10)
returns table (id uuid, prize_amount bigint, status text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  return query select s.id, s.prize_amount, s.status, s.created_at from wheel_spins s
  where s.player_id = public.player_uid() order by s.created_at desc limit least(greatest(p_limit, 1), 50);
end $$;

-- Спин. Приз выбирает сервер ДО анимации: клиент только показывает уже готовый результат.
-- Параллельные запросы одного игрока выстраиваются в очередь на блокировке строки баланса; второй видит запись первого и получает wheel_cooldown.
create or replace function public.wheel_spin() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := public.player_uid(); w wheel_settings; v_nick text; v_last timestamptz; v_next timestamptz;
  v_total int; v_n bigint; v_roll int; v_cum int := 0; r record; v_prize wheel_prizes; v_idx int := 0; v_pick_idx int;
  v_spin uuid := gen_random_uuid(); v_res jsonb; v_bytes bytea;
  c_limit constant bigint := 4294967296 - (4294967296 % 10000);   -- отбрасываем «хвост», чтобы остаток от деления был равномерным
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select nickname into v_nick from player_accounts where id = v_uid;
  insert into player_balances (player_id) values (v_uid) on conflict do nothing;
  perform 1 from player_balances where player_id = v_uid for update;          -- сериализация спинов игрока
  select * into w from wheel_settings;
  if not w.enabled then raise exception 'wheel_disabled'; end if;
  select max(created_at) into v_last from wheel_spins where player_id = v_uid;
  v_next := v_last + make_interval(hours => w.cooldown_hours);
  if v_last is not null and v_next > now() then raise exception 'wheel_cooldown' using detail = to_char(v_next at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'); end if;
  select coalesce(sum(chance_bp), 0) into v_total from wheel_prizes;
  if v_total <> 10000 then raise exception 'prizes_invalid'; end if;
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_n := (get_byte(v_bytes, 0)::bigint << 24) | (get_byte(v_bytes, 1)::bigint << 16) | (get_byte(v_bytes, 2)::bigint << 8) | get_byte(v_bytes, 3)::bigint;
    exit when v_n < c_limit;
  end loop;
  v_roll := (v_n % 10000)::int;
  for r in select * from wheel_prizes order by position, id loop
    v_cum := v_cum + r.chance_bp;
    if v_roll < v_cum then v_prize := r; v_pick_idx := v_idx; exit; end if;
    v_idx := v_idx + 1;
  end loop;
  v_res := public.economy_apply(v_uid, v_prize.amount, 'wheel_win', 'Колесо удачи', 'wheel_spin', v_spin);
  insert into wheel_spins (id, player_id, player_nickname, prize_amount, chance_bp, status, tx_id)
  values (v_spin, v_uid, v_nick, v_prize.amount, v_prize.chance_bp, 'completed', (v_res ->> 'tx_id')::bigint);
  return jsonb_build_object('spin_id', v_spin, 'prize_index', v_pick_idx, 'prize_amount', v_prize.amount, 'balance', (v_res ->> 'balance')::bigint,
                            'next_spin_at', now() + make_interval(hours => w.cooldown_hours), 'server_now', now());
end $$;

-- ---------- Администратор (право 'economy') ----------
create or replace function public.admin_economy_players(p_query text default null, p_limit int default 20, p_offset int default 0)
returns table (id uuid, nickname text, balance bigint, last_spin_at timestamptz, created_at timestamptz, total_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.admin_has('economy') then raise exception 'forbidden'; end if;
  if v_q is not null and char_length(v_q) < 2 then raise exception 'query_too_short'; end if;
  return query
  select a.id, a.nickname, coalesce(b.balance, 0), (select max(s.created_at) from wheel_spins s where s.player_id = a.id), a.created_at, count(*) over ()
  from player_accounts a left join player_balances b on b.player_id = a.id
  where v_q is null or a.nickname ilike '%' || like_escape(v_q) || '%' or a.id::text = v_q
  order by coalesce(b.balance, 0) desc, a.nickname
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_adjust_balance(p_player uuid, p_amount bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.admin_has('economy') then raise exception 'forbidden'; end if;
  if char_length(v_reason) < 3 then raise exception 'reason_required'; end if;
  if char_length(v_reason) > 300 then raise exception 'reason_too_long'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000 then raise exception 'invalid_amount'; end if;
  if not exists (select 1 from player_accounts where id = p_player) then raise exception 'player_not_found'; end if;
  return public.economy_apply(p_player, p_amount, case when p_amount > 0 then 'admin_credit' else 'admin_debit' end,
                              v_reason, 'admin', null, auth.uid(), public.admin_label());
end $$;

create or replace function public.admin_economy_transactions(p_player uuid default null, p_query text default null, p_limit int default 30, p_offset int default 0)
returns table (id bigint, player_id uuid, player_nickname text, kind text, amount bigint, balance_after bigint, reason text, admin_name text, ref_type text, ref_id uuid, created_at timestamptz, total_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.admin_has('economy') then raise exception 'forbidden'; end if;
  return query
  select t.id, t.player_id, t.player_nickname, t.kind, t.amount, t.balance_after, t.reason, t.admin_name, t.ref_type, t.ref_id, t.created_at, count(*) over ()
  from economy_transactions t
  where (p_player is null or t.player_id = p_player)
    and (v_q is null or t.player_nickname ilike '%' || like_escape(v_q) || '%' or t.admin_name ilike '%' || like_escape(v_q) || '%' or t.player_id::text = v_q)
  order by t.created_at desc, t.id desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_wheel_config() returns jsonb
language plpgsql security definer set search_path = public as $$
declare w wheel_settings;
begin
  if not public.admin_has('economy') then raise exception 'forbidden'; end if;
  select * into w from wheel_settings;
  return jsonb_build_object('enabled', w.enabled, 'cooldown_hours', w.cooldown_hours,
    'prizes', coalesce((select jsonb_agg(jsonb_build_object('amount', amount, 'chance_bp', chance_bp) order by position, id) from wheel_prizes), '[]'::jsonb),
    'total_bp', (select coalesce(sum(chance_bp), 0) from wheel_prizes),
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'admin_name', l.admin_name, 'details', l.details, 'occurred_at', l.occurred_at) order by l.occurred_at desc)
                     from (select * from economy_admin_log order by occurred_at desc, id desc limit 10) l), '[]'::jsonb));
end $$;

create or replace function public.admin_set_wheel_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_has('economy') then raise exception 'forbidden'; end if;
  if p_enabled is null then raise exception 'invalid_amount'; end if;
  update wheel_settings set enabled = p_enabled, updated_at = now();
  insert into economy_admin_log (action, admin_id, admin_name) values (case when p_enabled then 'wheel_enabled' else 'wheel_disabled' end, auth.uid(), public.admin_label());
end $$;

-- Призы заменяются целиком и атомарно. Формат: [{"amount": 50, "chance_bp": 3500}, ...]; сумма chance_bp ровно 10000.
create or replace function public.admin_set_wheel_prizes(p_prizes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e jsonb; v_sum bigint := 0; v_pos int := 0; v_amount numeric; v_bp numeric;
begin
  if not public.admin_has('economy') then raise exception 'forbidden'; end if;
  if p_prizes is null or jsonb_typeof(p_prizes) <> 'array' or jsonb_array_length(p_prizes) not between 2 and 12 then raise exception 'prizes_invalid'; end if;
  for e in select * from jsonb_array_elements(p_prizes) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'amount') <> 'number' or jsonb_typeof(e -> 'chance_bp') <> 'number' then raise exception 'prizes_invalid'; end if;
    v_amount := (e ->> 'amount')::numeric; v_bp := (e ->> 'chance_bp')::numeric;
    if v_amount <> trunc(v_amount) or v_amount < 1 or v_amount > 1000000000 then raise exception 'prizes_invalid'; end if;
    if v_bp <> trunc(v_bp) or v_bp < 1 or v_bp > 10000 then raise exception 'prizes_invalid'; end if;
    v_sum := v_sum + v_bp::bigint;
  end loop;
  if v_sum <> 10000 then raise exception 'chances_sum_invalid'; end if;
  perform 1 from wheel_settings for update;
  delete from wheel_prizes;
  for e in select * from jsonb_array_elements(p_prizes) loop
    v_pos := v_pos + 1;
    insert into wheel_prizes (position, amount, chance_bp) values (v_pos, (e ->> 'amount')::bigint, (e ->> 'chance_bp')::int);
  end loop;
  insert into economy_admin_log (action, details, admin_id, admin_name) values ('prizes_changed', p_prizes, auth.uid(), public.admin_label());
end $$;

create or replace function public.admin_wheel_spins(p_query text default null, p_limit int default 30, p_offset int default 0)
returns table (id uuid, player_id uuid, player_nickname text, prize_amount bigint, chance_bp int, status text, tx_id bigint, created_at timestamptz, total_count bigint)
language plpgsql security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.admin_has('economy') then raise exception 'forbidden'; end if;
  return query
  select s.id, s.player_id, s.player_nickname, s.prize_amount, s.chance_bp, s.status, s.tx_id, s.created_at, count(*) over ()
  from wheel_spins s where v_q is null or s.player_nickname ilike '%' || like_escape(v_q) || '%' or s.player_id::text = v_q
  order by s.created_at desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_wheel_stats() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_has('economy') then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'total_spins', (select count(*) from wheel_spins),
    'spins_24h', (select count(*) from wheel_spins where created_at > now() - interval '24 hours'),
    'unique_players', (select count(distinct player_id) from wheel_spins),
    'total_paid', (select coalesce(sum(prize_amount), 0) from wheel_spins),
    'coins_in_circulation', (select coalesce(sum(balance), 0) from player_balances),
    'expected_per_spin', (select coalesce(sum(amount * chance_bp), 0)::numeric / 10000 from wheel_prizes),
    'by_prize', coalesce((select jsonb_agg(jsonb_build_object('amount', x.prize_amount, 'count', x.n) order by x.prize_amount)
                          from (select prize_amount, count(*) n from wheel_spins group by prize_amount) x), '[]'::jsonb));
end $$;

-- ---------- Права ----------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_player_balance','economy_apply','wheel_next_spin_at','economy_me','my_transactions','my_spins','wheel_spin',
             'admin_economy_players','admin_adjust_balance','admin_economy_transactions','admin_wheel_config','admin_set_wheel_enabled','admin_set_wheel_prizes','admin_wheel_spins','admin_wheel_stats')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
-- Игрок: anon-ключ + токен в заголовке (как в 006); каждая функция сама проверяет токен.
grant execute on function public.economy_me(), public.my_transactions(int, int), public.my_spins(int), public.wheel_spin() to anon, authenticated;
grant execute on function public.admin_economy_players(text, int, int), public.admin_adjust_balance(uuid, bigint, text),
  public.admin_economy_transactions(uuid, text, int, int), public.admin_wheel_config(), public.admin_set_wheel_enabled(boolean),
  public.admin_set_wheel_prizes(jsonb), public.admin_wheel_spins(text, int, int), public.admin_wheel_stats() to authenticated;
