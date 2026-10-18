-- Tilliworld: миграция 012 — усиление безопасности магазина, безопасная выдача и повтор/возврат.
-- Применять ПОСЛЕ 011. Повторный запуск безопасен. Данные не удаляются и не меняются.
--
-- Что исправляется (найдено при аудите частей 1–2):
--   1. Политики products/orders проверяли только роль admin (is_admin()), а не право. Администратор с ограниченными правами
--      (например, только 'moderate') мог через REST менять цены и ключи выдачи товаров и отклонять заказы (а отклонение возвращает монеты).
--      Теперь запись в products, orders и Storage требует права 'shop' (полный администратор без списка permissions или с 'all' имеет его автоматически).
--      Чтение заявок и каталога для любого администратора не меняется.
--   2. Возврат монет мог выполниться ПОСЛЕ выдачи предмета (completed -> rejected) и во время выдачи (processing) — игрок получал и предмет, и монеты.
--      Теперь для оплаченных заказов: из completed выйти нельзя; отклонить заказ в статусе выдачи 'processing' нельзя (сначала отметить ошибку выдачи).
--   3. Поля fulfillment_* можно было менять напрямую запросом администратора. Теперь только функцией admin_fulfillment_step (строгие переходы, блокировка строки, идемпотентность).
--   4. Служебные триггерные функции были доступны anon/authenticated на EXECUTE (вызвать как триггер нельзя, но лишние права убираем).

-- ---------- 1. Право 'shop' ----------
drop policy if exists "admin inserts products" on public.products;
drop policy if exists "admin updates products" on public.products;
drop policy if exists "admin deletes products" on public.products;
create policy "admin inserts products" on public.products for insert to authenticated with check (public.admin_has('shop'));
create policy "admin updates products" on public.products for update to authenticated using (public.admin_has('shop')) with check (public.admin_has('shop'));
create policy "admin deletes products" on public.products for delete to authenticated using (public.admin_has('shop'));

drop policy if exists "admin updates orders" on public.orders;
create policy "admin updates orders" on public.orders for update to authenticated using (public.admin_has('shop')) with check (public.admin_has('shop'));

drop policy if exists "admin uploads product images" on storage.objects;
drop policy if exists "admin updates product images" on storage.objects;
drop policy if exists "admin deletes product images" on storage.objects;
create policy "admin uploads product images" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.admin_has('shop'));
create policy "admin updates product images" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.admin_has('shop')) with check (bucket_id = 'product-images' and public.admin_has('shop'));
create policy "admin deletes product images" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.admin_has('shop'));

-- ---------- 2. Защита полей заказа (в том числе fulfillment_*) от прямой записи клиентом ----------
-- current_user внутри обычного триггера — роль вызывающего: при запросе через PostgREST это authenticated/anon.
-- Внутри SECURITY DEFINER-функции (admin_fulfillment_step, триггеры синхронизации) это владелец, и поля менять можно.
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
  if current_user in ('anon', 'authenticated') and (
       new.fulfillment_status   is distinct from old.fulfillment_status
    or new.fulfillment_attempts is distinct from old.fulfillment_attempts
    or new.fulfilled_at         is distinct from old.fulfilled_at
    or new.fulfillment_note     is distinct from old.fulfillment_note
  ) then
    raise exception 'fulfillment_fields_protected';
  end if;
  return new;
end $$;

-- ---------- 3. Возврат: только когда предмет не выдан и не выдаётся ----------
create or replace function public.orders_refund_on_reject() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  if old.refunded_at is not null and old.status = 'rejected' and new.status is distinct from 'rejected' then
    raise exception 'order_refunded';       -- монеты уже возвращены: нельзя «воскресить» заказ и выдать предмет бесплатно
  end if;
  if old.price_paid is not null and old.status = 'completed' and new.status is distinct from 'completed' then
    raise exception 'order_fulfilled';      -- предмет выдан: ни вернуть монеты, ни выдать повторно
  end if;
  if new.status = 'rejected' and old.status is distinct from 'rejected' and new.price_paid is not null and new.refunded_at is null and new.player_id is not null then
    if old.fulfillment_status = 'processing' then raise exception 'order_processing'; end if;   -- сначала зафиксировать итог выдачи (ошибка), затем возвращать
    v_res := public.economy_apply(new.player_id, new.price_paid, 'refund',
      'Возврат: ' || left(new.product_name_snapshot, 100) || ' (заказ #' || new.order_number || ')', 'shop_order', new.id, auth.uid(), case when auth.uid() is null then null else public.admin_label() end);
    new.refunded_at := now();
    new.refund_tx_id := (v_res ->> 'tx_id')::bigint;
  end if;
  return new;
end $$;

-- ---------- 4. Шаги выдачи: start -> (fail -> start)* -> done; возврат — через отклонение заказа ----------
-- start: pending|failed -> processing (попытка +1); fail: pending|processing -> failed (причина обязательна);
-- done: pending|processing|failed -> fulfilled и status = completed. Повтор done по уже выданному заказу ничего не меняет (duplicate = true).
create or replace function public.admin_fulfillment_step(p_order uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.admin_has('shop') then raise exception 'forbidden'; end if;
  if p_action is null or p_action not in ('start', 'fail', 'done') then raise exception 'invalid_action'; end if;
  if char_length(coalesce(v_note, '')) > 500 then raise exception 'note_too_long'; end if;
  select * into o from orders where id = p_order for update;
  if not found or o.price_paid is null then raise exception 'order_not_found'; end if;
  if o.status = 'rejected' or o.refunded_at is not null then raise exception 'order_refunded'; end if;
  if o.fulfillment_status = 'fulfilled' or o.status = 'completed' then
    return jsonb_build_object('order_id', o.id, 'status', o.status, 'fulfillment_status', o.fulfillment_status, 'attempts', o.fulfillment_attempts, 'duplicate', true);
  end if;

  if p_action = 'start' then
    if o.fulfillment_status = 'processing' then raise exception 'already_processing'; end if;
    if o.fulfillment_attempts >= 1000 then raise exception 'attempts_exceeded'; end if;
    update orders set fulfillment_status = 'processing', fulfillment_attempts = fulfillment_attempts + 1, fulfillment_note = v_note where id = o.id returning * into o;
  elsif p_action = 'fail' then
    if v_note is null or char_length(v_note) < 3 then raise exception 'note_required'; end if;
    update orders set fulfillment_status = 'failed', fulfillment_note = v_note where id = o.id returning * into o;
  else
    update orders set status = 'completed', fulfillment_note = v_note where id = o.id returning * into o;   -- триггер orders_sync_fulfillment выставит fulfilled и fulfilled_at
  end if;
  return jsonb_build_object('order_id', o.id, 'status', o.status, 'fulfillment_status', o.fulfillment_status, 'attempts', o.fulfillment_attempts, 'duplicate', false);
end $$;

-- ---------- 5. Права ----------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('orders_sync_fulfillment', 'products_enforce_permanent_privilege', 'orders_refund_on_reject', 'admin_fulfillment_step')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
grant execute on function public.admin_fulfillment_step(uuid, text, text) to authenticated;
