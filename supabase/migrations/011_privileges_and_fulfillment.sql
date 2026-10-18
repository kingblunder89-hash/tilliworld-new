-- Tilliworld migration 011: product types, privileges and explicit fulfillment tracking.
-- Apply after 010_shop_purchases.sql. Additive migration; preserves existing products/orders.
alter table public.products
  add column if not exists product_type text not null default 'item',
  add column if not exists grant_key text,
  add column if not exists duration_days integer;

alter table public.products drop constraint if exists products_product_type_valid;
alter table public.products add constraint products_product_type_valid
  check (product_type in ('item','privilege'));
alter table public.products drop constraint if exists products_duration_days_range;
alter table public.products add constraint products_duration_days_range
  check (duration_days is null or duration_days between 1 and 3650);
alter table public.products drop constraint if exists products_grant_key_format;
alter table public.products add constraint products_grant_key_format
  check (grant_key is null or grant_key ~ '^[a-zA-Z0-9_.:-]{1,100}$');

-- Existing orders are the transaction history and already have unique (player_id, request_id), paid amount,
-- timestamps, status and refund linkage. Add delivery metadata without creating a competing ledger.
alter table public.orders
  add column if not exists fulfillment_status text not null default 'pending',
  add column if not exists fulfillment_attempts integer not null default 0,
  add column if not exists fulfilled_at timestamptz,
  add column if not exists fulfillment_note text;
alter table public.orders drop constraint if exists orders_fulfillment_status_valid;
alter table public.orders add constraint orders_fulfillment_status_valid
  check (fulfillment_status in ('pending','processing','fulfilled','failed','refunded'));
alter table public.orders drop constraint if exists orders_fulfillment_attempts_range;
alter table public.orders add constraint orders_fulfillment_attempts_range
  check (fulfillment_attempts between 0 and 1000);

-- Delivery metadata is restricted by the existing orders RLS to admin workflows; the guard below continues protecting purchase identity and payment fields.
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
    or new.refunded_at            is distinct from old.refunded_at
    or new.refund_tx_id           is distinct from old.refund_tx_id
  ) then raise exception 'orders_immutable_fields'; end if;
  return new;
end $$;

-- Manual status updates via existing admin workflow update fulfillment state as well.
create or replace function public.orders_sync_fulfillment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.price_paid is not null then
    if new.status = 'completed' then
      new.fulfillment_status := 'fulfilled';
      new.fulfilled_at := coalesce(new.fulfilled_at, now());
    elsif new.status = 'rejected' then
      new.fulfillment_status := 'refunded';
    elsif new.status = 'new' and old.status is distinct from 'new' then
      new.fulfillment_status := 'pending';
      new.fulfilled_at := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_sync_fulfillment on public.orders;
create trigger orders_sync_fulfillment before update on public.orders
for each row execute function public.orders_sync_fulfillment();

-- Product deletion is intentionally not used by the UI: hide/disable instead, preserving purchase history.

-- A permanent privilege can only be bought once, even if an admin client accidentally submits repeatable mode.
create or replace function public.products_enforce_permanent_privilege() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.product_type = 'privilege' and new.duration_days is null then
    new.purchase_mode := 'one_time';
    new.max_per_player := 1;
    new.repurchase_cooldown_hours := null;
  end if;
  return new;
end $$;
drop trigger if exists products_permanent_privilege_guard on public.products;
create trigger products_permanent_privilege_guard before insert or update of product_type, duration_days, purchase_mode, max_per_player, repurchase_cooldown_hours
on public.products for each row execute function public.products_enforce_permanent_privilege();
