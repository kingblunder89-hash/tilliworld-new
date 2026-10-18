-- Tilliworld: миграция 010 — покупка предметов за монеты сайта.
-- Применять ПОСЛЕ 009. Повторный запуск безопасен, существующие данные не удаляются и не меняются.
--
-- Что НЕ создаётся заново: пользователи (player_accounts), баланс (player_balances), журнал (economy_transactions), товары (products), заказы (orders).
-- Что добавляется:
--   * products: цена в монетах и правила повторной покупки (price_coins, purchase_mode, max_per_player, repurchase_cooldown_hours);
--   * orders: связь с игроком, уплаченная цена, ключ идемпотентности, данные возврата;
--   * shop_purchase(): единственный путь покупки. Цена, баланс и правила берутся ИЗ БАЗЫ; клиент не передаёт и не может изменить сумму списания.
--   * автоматический возврат монет при отклонении оплаченного заказа администратором;
--   * shop_my_purchases(), shop_my_orders(): чтение собственных покупок.
--
-- ВАЖНО про выдачу: сайт не связан с игровым сервером (плагин только подтверждает ник). Покупка создаёт заказ со статусом 'new' («ожидает выдачи»);
-- предмет выдаёт администратор вручную и ставит статус 'completed'. Сайт нигде не утверждает, что предмет выдан, пока админ этого не отметил.

-- ---------- 1. Товары: цена и правила повторной покупки ----------
alter table public.products
  add column if not exists price_coins bigint,                                  -- null = за монеты не продаётся (остаётся обычная заявка)
  add column if not exists purchase_mode text not null default 'repeatable',    -- 'one_time' — один раз на аккаунт; 'repeatable' — многоразовый
  add column if not exists max_per_player int,                                  -- для многоразовых: максимум покупок на игрока (null = без лимита)
  add column if not exists repurchase_cooldown_hours int;                       -- пауза между покупками одним игроком (null = без паузы)

alter table public.products drop constraint if exists products_price_coins_range;
alter table public.products add constraint products_price_coins_range check (price_coins is null or price_coins between 1 and 1000000000);
alter table public.products drop constraint if exists products_purchase_mode_valid;
alter table public.products add constraint products_purchase_mode_valid check (purchase_mode in ('one_time', 'repeatable'));
alter table public.products drop constraint if exists products_max_per_player_range;
alter table public.products add constraint products_max_per_player_range check (max_per_player is null or max_per_player between 1 and 1000);
alter table public.products drop constraint if exists products_cooldown_range;
alter table public.products add constraint products_cooldown_range check (repurchase_cooldown_hours is null or repurchase_cooldown_hours between 1 and 8760);

-- ---------- 2. Заказы: связь с покупкой ----------
alter table public.orders
  add column if not exists player_id uuid references public.player_accounts(id) on delete set null,  -- null у обычных заявок без оплаты
  add column if not exists price_paid bigint check (price_paid is null or price_paid > 0),
  add column if not exists request_id uuid,                                      -- ключ идемпотентности: повтор запроса не создаёт вторую покупку
  add column if not exists purchase_tx_id bigint,
  add column if not exists nickname_verified boolean not null default false,     -- ник выдачи взят из подтверждённой привязки Minecraft
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_tx_id bigint;
create unique index if not exists orders_player_request on public.orders (player_id, request_id) where request_id is not null;
create index if not exists orders_player_product on public.orders (player_id, product_id, created_at desc) where player_id is not null;

-- Администратор по-прежнему может менять в заказе только статус: новые поля тоже защищены.
create or replace function public.orders_guard_update() returns trigger
language plpgsql as $$
begin
  if auth.jwt() is not null and (
       new.id                    is distinct from old.id
    or new.order_number          is distinct from old.order_number
    or new.minecraft_nickname    is distinct from old.minecraft_nickname
    or new.product_id            is distinct from old.product_id
    or new.product_name_snapshot is distinct from old.product_name_snapshot
    or new.quantity              is distinct from old.quantity
    or new.comment               is distinct from old.comment
    or new.created_at            is distinct from old.created_at
    or new.player_id             is distinct from old.player_id
    or new.price_paid            is distinct from old.price_paid
    or new.request_id            is distinct from old.request_id
    or new.purchase_tx_id        is distinct from old.purchase_tx_id
    or new.nickname_verified     is distinct from old.nickname_verified
    or new.refunded_at           is distinct from old.refunded_at
    or new.refund_tx_id          is distinct from old.refund_tx_id
  ) then
    raise exception 'orders_immutable_fields';
  end if;
  return new;
end $$;

-- Возврат монет при отклонении оплаченного заказа: один раз, в той же транзакции, что и смена статуса.
-- Триггер называется orders_refund и срабатывает после orders_guard (порядок по имени), поэтому админ не может подделать поля возврата сам.
create or replace function public.orders_refund_on_reject() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  if old.refunded_at is not null and old.status = 'rejected' and new.status is distinct from 'rejected' then
    raise exception 'order_refunded';       -- монеты уже возвращены: нельзя «воскресить» заказ и выдать предмет бесплатно
  end if;
  if new.status = 'rejected' and old.status is distinct from 'rejected' and new.price_paid is not null and new.refunded_at is null and new.player_id is not null then
    v_res := public.economy_apply(new.player_id, new.price_paid, 'refund',
      'Возврат: ' || left(new.product_name_snapshot, 100) || ' (заказ #' || new.order_number || ')', 'shop_order', new.id, auth.uid(), case when auth.uid() is null then null else public.admin_label() end);
    new.refunded_at := now();
    new.refund_tx_id := (v_res ->> 'tx_id')::bigint;
  end if;
  return new;
end $$;
drop trigger if exists orders_refund on public.orders;
create trigger orders_refund before update on public.orders for each row execute function public.orders_refund_on_reject();

-- ---------- 3. Обычные заявки: за монеты продаваемые предметы бесплатно заказывать нельзя ----------
create or replace function public.create_order(p_product_id uuid, p_nickname text, p_quantity int, p_comment text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_name text; v_price bigint; v_num bigint; v_nick text := btrim(coalesce(p_nickname, ''));
begin
  if v_nick !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'invalid_nickname'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then raise exception 'invalid_quantity'; end if;
  if char_length(coalesce(p_comment, '')) > 500 then raise exception 'comment_too_long'; end if;

  select name, price_coins into v_name, v_price from products where id = p_product_id and is_published and is_available;
  if v_name is null then raise exception 'product_unavailable'; end if;
  if v_price is not null then raise exception 'priced_product'; end if;      -- такой предмет покупается за монеты через shop_purchase()

  if (select count(*) from orders where minecraft_nickname = v_nick and created_at > now() - interval '1 minute') >= 3
     or (select count(*) from orders where created_at > now() - interval '1 minute') >= 60 then
    raise exception 'rate_limited';
  end if;

  insert into orders (minecraft_nickname, product_id, product_name_snapshot, quantity, comment)
  values (v_nick, p_product_id, v_name, p_quantity, nullif(btrim(coalesce(p_comment, '')), ''))
  returning order_number into v_num;
  return v_num;
end $$;

-- ---------- 4. Покупка ----------
-- p_request_id — случайный UUID, который клиент создаёт один раз на попытку покупки и повторяет при повторной отправке:
--   повторный запрос с тем же ключом возвращает уже созданный заказ (duplicate = true) и НЕ списывает монеты второй раз.
-- p_expected_price — цена, которую видел игрок. Если она изменилась, покупка отклоняется (price_changed), чтобы не списать больше, чем показано.
--   Это только защита от неожиданности: списывается всегда цена из базы.
-- Все покупки игрока сериализуются блокировкой строки его баланса, поэтому два одновременных запроса не обойдут ни баланс, ни правила повторной покупки.
create or replace function public.shop_purchase(p_product_id uuid, p_request_id uuid, p_expected_price bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.player_uid(); pr products; o orders; v_res jsonb; v_id uuid := gen_random_uuid(); v_num bigint;
  v_nick text; v_mc text; v_cnt int; v_last timestamptz; v_next timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_product_id is null or p_request_id is null then raise exception 'invalid_request'; end if;

  insert into player_balances (player_id) values (v_uid) on conflict do nothing;
  perform 1 from player_balances where player_id = v_uid for update;            -- сериализация покупок игрока

  select * into o from orders where player_id = v_uid and request_id = p_request_id;
  if found then
    if o.product_id is distinct from p_product_id then raise exception 'invalid_request'; end if;
    return jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'product_name', o.product_name_snapshot, 'price', o.price_paid,
      'status', o.status, 'balance', (select balance from player_balances where player_id = v_uid), 'duplicate', true);
  end if;

  if (select count(*) from orders where player_id = v_uid and created_at > now() - interval '1 minute') >= 10 then raise exception 'rate_limited'; end if;

  select * into pr from products where id = p_product_id and is_published and is_available;
  if not found then raise exception 'product_unavailable'; end if;
  if pr.price_coins is null then raise exception 'not_for_sale'; end if;
  if p_expected_price is not null and p_expected_price <> pr.price_coins then raise exception 'price_changed' using detail = pr.price_coins::text; end if;

  -- правила повторной покупки; отклонённые (и потому возвращённые) заказы не считаются
  select count(*), max(created_at) into v_cnt, v_last from orders
   where player_id = v_uid and product_id = pr.id and price_paid is not null and status <> 'rejected';
  if pr.purchase_mode = 'one_time' and v_cnt >= 1 then raise exception 'already_purchased'; end if;
  if pr.max_per_player is not null and v_cnt >= pr.max_per_player then raise exception 'purchase_limit'; end if;
  if pr.repurchase_cooldown_hours is not null and v_last is not null then
    v_next := v_last + make_interval(hours => pr.repurchase_cooldown_hours);
    if v_next > now() then raise exception 'purchase_cooldown' using detail = to_char(v_next at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'); end if;
  end if;

  -- ник для выдачи: подтверждённый Minecraft-ник, если аккаунт привязан, иначе логин аккаунта (не подтверждён)
  select nickname into v_nick from player_accounts where id = v_uid;
  select mc_name into v_mc from minecraft_links where user_id = v_uid;

  -- списание (insufficient_funds откатывает всю транзакцию) и заказ — атомарно
  v_res := public.economy_apply(v_uid, -pr.price_coins, 'purchase', left(pr.name, 120), 'shop_order', v_id);
  insert into orders (id, minecraft_nickname, product_id, product_name_snapshot, quantity, status, player_id, price_paid, request_id, purchase_tx_id, nickname_verified)
  values (v_id, coalesce(v_mc, v_nick), pr.id, pr.name, 1, 'new', v_uid, pr.price_coins, p_request_id, (v_res ->> 'tx_id')::bigint, v_mc is not null)
  returning order_number into v_num;

  return jsonb_build_object('order_id', v_id, 'order_number', v_num, 'product_name', pr.name, 'price', pr.price_coins,
    'status', 'new', 'balance', (v_res ->> 'balance')::bigint, 'duplicate', false);
end $$;

-- ---------- 5. Чтение собственных покупок ----------
-- По каждому предмету: сколько покупок учитывается правилами и когда будет доступна следующая (если задана пауза). Для подсказок в интерфейсе;
-- решение всегда принимает shop_purchase().
create or replace function public.shop_my_purchases() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.player_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('server_now', now(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'purchases', x.n, 'last_at', x.last_at,
      'next_at', case when p.repurchase_cooldown_hours is not null then x.last_at + make_interval(hours => p.repurchase_cooldown_hours) end))
    from (select product_id, count(*) n, max(created_at) last_at from orders
          where player_id = v_uid and price_paid is not null and status <> 'rejected' and product_id is not null group by product_id) x
    join products p on p.id = x.product_id), '[]'::jsonb));
end $$;

create or replace function public.shop_my_orders(p_limit int default 20, p_offset int default 0)
returns table (id uuid, order_number bigint, product_name text, price bigint, status text, minecraft_nickname text, nickname_verified boolean,
               refunded boolean, created_at timestamptz, updated_at timestamptz, total_count bigint)
language plpgsql security definer set search_path = public as $$
begin
  if public.player_uid() is null then raise exception 'not_authenticated'; end if;
  return query
  select o.id, o.order_number, o.product_name_snapshot, o.price_paid, o.status, o.minecraft_nickname, o.nickname_verified,
         o.refunded_at is not null, o.created_at, o.updated_at, count(*) over ()
  from orders o where o.player_id = public.player_uid() and o.price_paid is not null
  order by o.created_at desc, o.order_number desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end $$;

-- ---------- 6. Права ----------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('shop_purchase', 'shop_my_purchases', 'shop_my_orders', 'orders_refund_on_reject')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
grant execute on function public.shop_purchase(uuid, uuid, bigint), public.shop_my_purchases(), public.shop_my_orders(int, int) to anon, authenticated;
revoke all on function public.create_order(uuid, text, int, text) from public;
grant execute on function public.create_order(uuid, text, int, text) to anon, authenticated;
