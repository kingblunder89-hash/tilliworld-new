#!/usr/bin/env bash
# Полный локальный прогон SQL-проверок: чистая БД -> заглушки -> миграции 001..011 -> run_tests.py, 010_shop_tests.sql, 010_shop_concurrency.sh, 012_security_tests.sql.
# Использует PG* переменные окружения. База tw_test пересоздаётся. НЕ запускать на рабочей базе.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TW_DB:-tw_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
export PGDATABASE=$DB
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase_stubs.sql
for m in 001 002 003 004 006 007 008 009 010 011 012; do
  f=$(ls supabase/migrations/${m}_*.sql 2>/dev/null || true); [ -n "$f" ] || continue
  echo "migration $f"; psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
rc=0
echo "== run_tests.py"; python3 supabase/tests/run_tests.py | tail -5 || rc=1
echo "== 010_shop_tests.sql"; psql -q -v ON_ERROR_STOP=1 -f supabase/tests/010_shop_tests.sql 2>&1 | tail -8 || rc=1
echo "== 010_shop_concurrency.sh"; bash supabase/tests/010_shop_concurrency.sh || rc=1
# Вторая база: те же миграции, но с default privileges Supabase (реалистичные гранты) для проверок безопасности 012.
DB2=${TW_DB2:-tw_test_grants}
psql -q -d postgres -c "drop database if exists $DB2" -c "create database $DB2"
export PGDATABASE=$DB2
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase_stubs.sql
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/supabase_default_privileges.sql
for f in supabase/migrations/0*.sql; do psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "migration failed: $f"; exit 1; }; done
echo "== 012_security_tests.sql (реалистичные гранты Supabase)"; psql -q -v ON_ERROR_STOP=1 -f supabase/tests/012_security_tests.sql 2>&1 | grep -E "Итого|ПРОВАЛЕНО|FAIL|получено|ERROR" || rc=1
exit $rc
