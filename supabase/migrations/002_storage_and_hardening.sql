-- Tilliworld Shop: миграция 002
-- 1) Storage для изображений предметов  2) заявки: админ меняет только статус  3) только https в image_url
-- Применять ПОСЛЕ 001_init.sql.

-- ---------- 1. Storage ----------
-- Публичный bucket: файлы читаются по прямой ссылке (каталог публичный), список файлов анонимам недоступен
-- (SELECT-политики для anon на storage.objects нет). Формат и размер ограничены и на уровне bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin reads product images" on storage.objects;
drop policy if exists "admin uploads product images" on storage.objects;
drop policy if exists "admin updates product images" on storage.objects;
drop policy if exists "admin deletes product images" on storage.objects;

create policy "admin reads product images" on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
create policy "admin uploads product images" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "admin updates product images" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "admin deletes product images" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- ---------- 2. Заявки: менять можно только status ----------
-- Даже администратор через API не может переписать ник, количество, комментарий или снимок названия:
-- история заявок остаётся неизменной. Прямой SQL (без JWT, например SQL Editor) не блокируется.
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
  ) then
    raise exception 'orders_immutable_fields';
  end if;
  return new;
end $$;

drop trigger if exists orders_guard on public.orders;
create trigger orders_guard before update on public.orders
  for each row execute function public.orders_guard_update();

-- ---------- 3. Только https-ссылки на изображения ----------
alter table public.products drop constraint if exists products_image_url_https;
alter table public.products add constraint products_image_url_https
  check (image_url is null or image_url ~ '^https://');
