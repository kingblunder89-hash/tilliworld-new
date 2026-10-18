-- Tilliworld Shop: миграция 003 — ручной статус сервера (включён / выключен).
-- Применять ПОСЛЕ 001_init.sql. Статус выставляет администратор вручную; сайт сам сервер не опрашивает.

create table if not exists public.server_status (
  id smallint primary key default 1 check (id = 1), -- ровно одна строка
  is_online boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Начальная строка: «выключен». Вставка выполняется владельцем миграции, RLS её не блокирует.
insert into public.server_status (id, is_online) values (1, false) on conflict (id) do nothing;

drop trigger if exists server_status_touch on public.server_status;
create trigger server_status_touch before update on public.server_status
  for each row execute function public.touch_updated_at();

alter table public.server_status enable row level security;

-- Читать статус может любой посетитель. Менять — только администратор (app_metadata.role = 'admin').
-- Политик INSERT/DELETE нет: создать вторую строку или удалить единственную через API нельзя.
drop policy if exists "public reads server status" on public.server_status;
drop policy if exists "admin updates server status" on public.server_status;
create policy "public reads server status" on public.server_status for select using (true);
create policy "admin updates server status" on public.server_status for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
