#!/usr/bin/env bash
# Параллельные покупки (миграция 010). Запуск на тестовой базе после 010_shop_tests.sql или сразу после миграций:
#   PGHOST=/tmp PGPORT=5444 PGUSER=postgres bash supabase/tests/010_shop_concurrency.sh
# Проверяет: двойной клик (один и тот же request_id), гонку одноразового товара и гонку за последние монеты.
set -u
fail=0
q() { psql -q -t -A -v ON_ERROR_STOP=1 "$@"; }
ok() { if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 (ожидалось '$3', получено '$2')"; fail=1; fi; }

q <<'SQL' >/dev/null
delete from orders where product_name_snapshot like 'C %';
delete from products where slug like 'c-%';
delete from player_accounts where nickname like 'c\_%';
insert into player_accounts (nickname, password_hash, approval_status) values ('c_dbl', 'x', 'approved'), ('c_once', 'x', 'approved'), ('c_last', 'x', 'approved');
insert into products (name, slug, price_coins, purchase_mode, is_published, is_available) values
  ('C once', 'c-once', 300, 'one_time', true, true), ('C multi', 'c-multi', 50, 'repeatable', true, true);
select economy_apply(id, 500, 'admin_credit', 'тест') from player_accounts where nickname in ('c_dbl', 'c_once');
select economy_apply(id, 100, 'admin_credit', 'тест') from player_accounts where nickname = 'c_last';
SQL
token() { q -c "select create_player_session(id) from player_accounts where nickname = '$1'"; }
# параллельно выполняет N одинаковых вызовов от имени игрока; печатает "ok" или код ошибки по строке на вызов
fire() { # nick, n, sql-вызов (может содержать %REQ% — заменяется на свой UUID или общий)
  local tok; tok=$(token "$1"); local out; out=$(mktemp)
  for i in $(seq "$2"); do
    ( sql=${3//%REQ%/${4:-$(cat /proc/sys/kernel/random/uuid)}}
      full=$(psql -q -t -A -c "select set_config('request.headers', '{\"x-player-token\":\"$tok\"}', false)" -c "set role anon" -c "$sql" 2>&1)
      err=$(echo "$full" | grep -m1 ERROR | sed -E 's/.*ERROR:  //')
      if [ -n "$err" ]; then echo "$err" >>"$out"; elif echo "$full" | grep -q order_id; then echo ok >>"$out"; else echo other >>"$out"; fi ) &
  done; wait; sort "$out" | uniq -c | tr -s ' ' | tr '\n' ';'; rm -f "$out"
}

echo "1. Двойной клик: 8 одновременных запросов с ОДНИМ request_id"
req=$(cat /proc/sys/kernel/random/uuid)
fire c_dbl 8 "select shop_purchase((select id from products where slug='c-multi'), '%REQ%')" "$req" >/dev/null
ok "один заказ" "$(q -c "select count(*) from orders o join player_accounts a on a.id=o.player_id where a.nickname='c_dbl'")" 1
ok "списано один раз (баланс 450)" "$(q -c "select balance from player_balances b join player_accounts a on a.id=b.player_id where a.nickname='c_dbl'")" 450

echo "2. Гонка: 8 одновременных покупок ОДНОРАЗОВОГО товара с разными request_id"
res=$(fire c_once 8 "select shop_purchase((select id from products where slug='c-once'), '%REQ%')"); echo "     $res"
ok "ровно один успех" "$(q -c "select count(*) from orders o join player_accounts a on a.id=o.player_id where a.nickname='c_once'")" 1
ok "баланс 200, списано один раз" "$(q -c "select balance from player_balances b join player_accounts a on a.id=b.player_id where a.nickname='c_once'")" 200

echo "3. Гонка за последние монеты: баланс 100, цена 50, 8 параллельных покупок"
res=$(fire c_last 8 "select shop_purchase((select id from products where slug='c-multi'), '%REQ%')"); echo "     $res"
ok "ровно 2 заказа" "$(q -c "select count(*) from orders o join player_accounts a on a.id=o.player_id where a.nickname='c_last'")" 2
ok "баланс 0, не отрицательный" "$(q -c "select balance from player_balances b join player_accounts a on a.id=b.player_id where a.nickname='c_last'")" 0
ok "2 списания в журнале" "$(q -c "select count(*) from economy_transactions x join player_accounts a on a.id=x.player_id where a.nickname='c_last' and x.kind='purchase'")" 2

[ "$fail" = 0 ] && echo "Все проверки пройдены" || { echo "Есть ошибки"; exit 1; }
