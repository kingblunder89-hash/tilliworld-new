-- Имитация default privileges Supabase: новые объекты в public доступны anon/authenticated/service_role (защищают RLS и revoke в миграциях).
-- Выполнять ДО миграций и от той же роли, которая их применяет. Только для тестовой базы.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
