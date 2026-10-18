-- Tilliworld Shop: таблицы, RLS, безопасная подача заявок
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (char_length(slug) between 1 and 140),
  description text not null default '' check (char_length(description) <= 4000),
  category text not null default 'Разное' check (char_length(category) <= 60),
  image_url text check (image_url is null or char_length(image_url) <= 500),
  display_price text check (display_price is null or char_length(display_price) <= 60), -- информационная/условная стоимость
  is_published boolean not null default false,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  minecraft_nickname text not null check (minecraft_nickname ~ '^[A-Za-z0-9_]{3,16}$'),
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text not null,
  quantity int not null check (quantity between 1 and 999),
  comment text check (comment is null or char_length(comment) <= 500),
  status text not null default 'new' check (status in ('new','accepted','completed','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.orders (created_at desc);
create index on public.orders (minecraft_nickname, created_at desc);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  author_name text not null check (char_length(author_name) <= 40),
  rating int not null check (rating between 1 and 5),
  body text not null check (char_length(body) <= 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

-- Администратор определяется ТОЛЬКО по app_metadata (пользователь не может её менять)
create or replace function public.is_admin() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.reviews enable row level security;

-- products
create policy "public reads published products" on public.products for select using (is_published);
create policy "admin reads all products" on public.products for select to authenticated using (public.is_admin());
create policy "admin inserts products" on public.products for insert to authenticated with check (public.is_admin());
create policy "admin updates products" on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes products" on public.products for delete to authenticated using (public.is_admin());

-- orders: прямого доступа у посетителей нет (нет INSERT/SELECT/UPDATE политик для anon)
create policy "admin reads orders" on public.orders for select to authenticated using (public.is_admin());
create policy "admin updates orders" on public.orders for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- reviews
create policy "public reads approved reviews" on public.reviews for select using (status = 'approved');
create policy "admin reads reviews" on public.reviews for select to authenticated using (public.is_admin());
create policy "admin updates reviews" on public.reviews for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes reviews" on public.reviews for delete to authenticated using (public.is_admin());

-- Единственный путь создания заявки для посетителей: валидирующая функция
create or replace function public.create_order(p_product_id uuid, p_nickname text, p_quantity int, p_comment text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_name text; v_num bigint; v_nick text := btrim(coalesce(p_nickname, ''));
begin
  if v_nick !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'invalid_nickname'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then raise exception 'invalid_quantity'; end if;
  if char_length(coalesce(p_comment, '')) > 500 then raise exception 'comment_too_long'; end if;

  select name into v_name from products where id = p_product_id and is_published and is_available;
  if v_name is null then raise exception 'product_unavailable'; end if;

  -- ограничение частоты: не больше 3 заявок на ник в минуту и 60 заявок в минуту на весь сайт
  if (select count(*) from orders where minecraft_nickname = v_nick and created_at > now() - interval '1 minute') >= 3
     or (select count(*) from orders where created_at > now() - interval '1 minute') >= 60 then
    raise exception 'rate_limited';
  end if;

  insert into orders (minecraft_nickname, product_id, product_name_snapshot, quantity, comment)
  values (v_nick, p_product_id, v_name, p_quantity, nullif(btrim(coalesce(p_comment, '')), ''))
  returning order_number into v_num;
  return v_num;
end $$;
revoke all on function public.create_order(uuid, text, int, text) from public;
grant execute on function public.create_order(uuid, text, int, text) to anon, authenticated;
