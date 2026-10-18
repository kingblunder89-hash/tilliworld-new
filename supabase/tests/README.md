# Тесты миграций 004, 006 и 007

Тесты идут на реальном PostgreSQL 16, где вместо Supabase подставлены заглушки схем `extensions` (для pgcrypto), `auth` (`users` с колонками `raw_app_meta_data` и `raw_user_meta_data`, `uid()`, `jwt()`) и `storage`, а роли `anon`/`authenticated` создаются вручную.

1. Поднимите чистую базу, создайте заглушки `auth`/`storage` и роли, примените миграции `001`–`004`, `006`, `007`, `008` и `009` по порядку.
2. `PGHOST=... PGPORT=... PGUSER=... python3 supabase/tests/run_tests.py` (нужен `pip install psycopg2-binary`).

Тесты миграции 010 (покупки) не требуют Python: после применения `001`–`010` выполните `psql -v ON_ERROR_STOP=1 -f supabase/tests/010_shop_tests.sql` (итог и код возврата в конце) и `bash supabase/tests/010_shop_concurrency.sh` (параллельные покупки: двойной клик, гонка за одноразовый товар и за последние монеты). Скрипты создают тестовых игроков `t_*`/`c_*` и товары `t-*`/`c-*`, поэтому запускать их нужно только на тестовой базе. В заглушку Supabase для них достаточно добавить права `grant select, update on public.orders to authenticated` (скрипт делает это сам).

Скрипт `run_tests.py` сам переключает роль (`set role`) и подставляет `request.jwt.claims`, как это делает PostgREST. Код возврата 1, если есть упавшие проверки.
