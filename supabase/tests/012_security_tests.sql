-- Тесты миграции 012 (безопасность, выдача, возврат, привилегии, колесо). Запуск на тестовой базе после миграций 001–012:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/012_security_tests.sql
-- ВАЖНО: база должна быть создана с default privileges Supabase (supabase_default_privileges.sql ДО миграций): тогда anon/authenticated получают
-- права на новые таблицы, как в настоящем проекте, и проверки «клиент не может писать» показывают работу RLS и revoke из миграций,
-- а не просто отсутствие грантов. Это делает run_all_sql_tests.sh (база tw_test_grants).
-- Не запускайте на рабочей базе: создаются тестовые игроки u_* и товары u-*.
\set ON_ERROR_STOP on
\pset pager off

drop schema if exists u cascade;
create schema u;
grant usage on schema u to public;
create table u.res (name text, ok boolean);
create table u.tok (nick text primary key, id uuid, token text);
create table u.ids (k text primary key, v uuid);
grant all on all tables in schema u to public;

create function u.check(p_name text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into u.res values (p_name, coalesce(p_cond, false));
  if not coalesce(p_cond, false) then raise warning 'FAIL: %', p_name; end if;
end $$;
create function u.expect(p_name text, p_sql text, p_code text) returns void language plpgsql as $$
declare m text;
begin
  begin execute p_sql; m := null; exception when others then m := sqlerrm; end;
  perform u.check(p_name || ' -> ' || p_code, m is not null and (position(p_code in m) > 0 or (p_code = 'forbidden' and m like '%permission denied%')));
  if m is null or position(p_code in m) = 0 then raise warning '   получено: %', m; end if;
end $$;
create function u.su() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', false); perform set_config('request.headers', '', false); reset role; end $$;
create function u.as_player(p_nick text) returns void language plpgsql as $$
begin
  perform u.su();
  perform set_config('request.headers', json_build_object('x-player-token', (select token from u.tok where nick = p_nick))::text, false);
  set role anon;
end $$;
-- p_perms = null: администратор без списка permissions (полный доступ, как у ранее созданных)
create function u.as_admin(p_perms jsonb default null) returns void language plpgsql as $$
declare meta jsonb := '{"role":"admin"}'::jsonb;
begin
  perform u.su();
  if p_perms is not null then meta := meta || jsonb_build_object('permissions', p_perms); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000ad01', 'role', 'authenticated', 'email', 'adm@test', 'app_metadata', meta)::text, false);
  set role authenticated;
end $$;
create function u.rows(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;
create function u.pid(p_k text) returns uuid language sql stable as $$ select v from u.ids where k = p_k $$;
create function u.bal(p_nick text) returns bigint language sql stable security definer as $$
  select b.balance from player_balances b join player_accounts a on a.id = b.player_id where a.nickname = p_nick $$;
create function u.oid(p_req uuid) returns uuid language sql stable security definer as $$ select id from orders where request_id = p_req $$;
grant execute on all functions in schema u to public;

-- ---------- данные ----------
select u.su();
delete from orders where product_name_snapshot like 'U %';
delete from products where slug like 'u-%';
delete from player_accounts where nickname like 'u\_%';
insert into player_accounts (nickname, password_hash, approval_status) select n, 'x', 'approved' from unnest(array['u_alice', 'u_bob', 'u_wheel']) n;
insert into u.tok select a.nickname, a.id, create_player_session(a.id) from player_accounts a where a.nickname like 'u\_%';
insert into products (name, slug, price_coins, purchase_mode, is_published, is_available, product_type, grant_key, duration_days) values
  ('U sword', 'u-sword', 100, 'repeatable', true, true, 'item', null, null),
  ('U vip forever', 'u-vip', 500, 'repeatable', true, true, 'privilege', 'vip', null),     -- намеренно repeatable: триггер должен сделать one_time
  ('U vip 30d', 'u-vip30', 50, 'repeatable', true, true, 'privilege', 'vip30', 30);
insert into u.ids select regexp_replace(slug, '^u-', ''), id from products where slug like 'u-%';
select economy_apply((select id from u.tok where nick = 'u_alice'), 2000, 'admin_credit', 'тест');
select economy_apply((select id from u.tok where nick = 'u_bob'), 100, 'admin_credit', 'тест');

\echo '1. Клиент не может менять баланс, цену, заказы, права (с грантами как в Supabase: защищает RLS, а не отсутствие прав)'
select u.as_player('u_alice');
select u.check('игрок: update products не затронул ни одной строки', u.rows($sql$update products set price_coins = 1$sql$) = 0);
select u.expect('игрок: update баланса (revoke)', $$update player_balances set balance = 999999$$, 'permission denied');
select u.expect('игрок: select баланса напрямую', $$select * from player_balances$$, 'permission denied');
select u.expect('игрок: select журнала напрямую', $$select * from economy_transactions$$, 'permission denied');
select u.expect('игрок: insert в журнал напрямую', $$insert into economy_transactions (player_id, player_nickname, kind, amount, balance_after, reason) values (gen_random_uuid(), 'x', 'admin_credit', 5, 5, 'x')$$, 'permission denied');
select u.expect('игрок: insert в wheel_spins', $$insert into wheel_spins (player_id, player_nickname, prize_amount, chance_bp, status) values (gen_random_uuid(), 'x', 5, 1, 'completed')$$, 'permission denied');
select u.expect('игрок: update wheel_prizes', $$update wheel_prizes set amount = 999999$$, 'permission denied');
select u.expect('игрок: update wheel_settings', $$update wheel_settings set cooldown_hours = 0$$, 'permission denied');
select u.check('игрок: orders не видны (RLS)', (select count(*) = 0 from orders));
select u.check('игрок: update orders не затронул строк', u.rows($sql$update orders set status = 'completed'$sql$) = 0);
select u.expect('игрок: insert в orders', $$insert into orders (minecraft_nickname, product_name_snapshot, quantity, price_paid) values ('Hack', 'x', 1, 1)$$, 'row-level security');
select u.expect('игрок: insert в products', $$insert into products (name, slug, description, category) values ('x', 'u-evil', 'x', 'x')$$, 'row-level security');
select u.expect('игрок: economy_apply', $$select economy_apply(gen_random_uuid(), 100, 'admin_credit', 'hack')$$, 'permission denied');
select u.expect('игрок: admin_adjust_balance', $$select admin_adjust_balance(gen_random_uuid(), 100, 'hack')$$, 'permission denied');
select u.expect('игрок: admin_fulfillment_step', $$select admin_fulfillment_step(gen_random_uuid(), 'done')$$, 'permission denied');
select u.expect('игрок: триггерная функция sync', $$select orders_sync_fulfillment()$$, 'permission denied');
select u.expect('игрок: триггерная функция возврата', $$select orders_refund_on_reject()$$, 'permission denied');
select u.su(); set role anon;
select u.expect('аноним: admin_adjust_balance', $$select admin_adjust_balance(gen_random_uuid(), 100, 'hack')$$, 'permission denied');
select u.expect('аноним: admin_set_wheel_prizes', $$select admin_set_wheel_prizes('[{"amount":1000000,"chance_bp":10000},{"amount":1,"chance_bp":0}]'::jsonb)$$, 'permission denied');
select u.expect('аноним: admin_fulfillment_step', $$select admin_fulfillment_step(gen_random_uuid(), 'done')$$, 'permission denied');
select u.expect('аноним: покупка без входа', $$select shop_purchase(u.pid('sword'), gen_random_uuid())$$, 'not_authenticated');
select u.expect('аноним: колесо без входа', $$select wheel_spin()$$, 'not_authenticated');

\echo '2. Покупки: достаточный/недостаточный баланс, атомарность'
select u.as_player('u_alice');
select set_config('u.req_sword', gen_random_uuid()::text, false);
create temp table p1 as select shop_purchase(u.pid('sword'), current_setting('u.req_sword')::uuid, 100) r;
select u.check('покупка: баланс 1900, статус new, не дубль', (select (r->>'balance')::bigint = 1900 and r->>'status' = 'new' and (r->>'duplicate')::boolean = false from p1));
select u.su();
select u.check('заказ: pending, 0 попыток, оплачено 100', (select fulfillment_status = 'pending' and fulfillment_attempts = 0 and price_paid = 100 from orders where request_id = current_setting('u.req_sword')::uuid));
select count(*) as bob_tx_before from economy_transactions x join player_accounts a on a.id = x.player_id where a.nickname = 'u_bob' \gset
select u.as_player('u_bob');
select u.expect('недостаточный баланс (100 < 500)', $$select shop_purchase(u.pid('vip'), gen_random_uuid())$$, 'insufficient_funds');
select u.su();
select u.check('после отказа баланс 100, заказа и списания нет (атомарность)', u.bal('u_bob') = 100
  and (select count(*) from orders o join player_accounts a on a.id = o.player_id where a.nickname = 'u_bob') = 0
  and (select count(*) from economy_transactions x join player_accounts a on a.id = x.player_id where a.nickname = 'u_bob') = :bob_tx_before);

\echo '3. Постоянная привилегия: одна покупка, повтор запрещён, после возврата разрешён'
select u.su();
select u.check('триггер: постоянная привилегия принудительно one_time, лимит 1', (select purchase_mode = 'one_time' and max_per_player = 1 from products where slug = 'u-vip'));
select u.check('срочная привилегия остаётся repeatable', (select purchase_mode = 'repeatable' from products where slug = 'u-vip30'));
select u.as_player('u_alice');
select set_config('u.req_vip', gen_random_uuid()::text, false);
select shop_purchase(u.pid('vip'), current_setting('u.req_vip')::uuid, 500);
select u.expect('повторная покупка постоянной привилегии', $$select shop_purchase(u.pid('vip'), gen_random_uuid())$$, 'already_purchased');
select u.check('баланс 1400 после одной покупки привилегии (1900 − 500)', u.bal('u_alice') = 1400);

\echo '4. Права администраторов: ограниченный, с правом shop, полный'
select u.as_admin('["moderate"]'::jsonb);
select u.check('админ moderate: видит заказы', (select count(*) >= 1 from orders));
select u.check('админ moderate: НЕ меняет цену товара (0 строк)', u.rows($sql$update products set price_coins = 1 where slug = 'u-sword'$sql$) = 0);
select u.check('админ moderate: НЕ меняет статус заказа (0 строк)', u.rows($sql$update orders set status = 'rejected' where request_id = current_setting('u.req_vip')::uuid$sql$) = 0);
select u.expect('админ moderate: НЕ создаёт товар', $$insert into products (name, slug, description, category) values ('x', 'u-evil2', 'x', 'x')$$, 'row-level security');
select u.expect('админ moderate: admin_fulfillment_step', format($$select admin_fulfillment_step(%L, 'done')$$, u.oid(current_setting('u.req_vip')::uuid)), 'forbidden');
select u.expect('админ moderate: admin_adjust_balance', format($$select admin_adjust_balance(%L, 100000, 'hack')$$, (select id from u.tok where nick = 'u_bob')), 'forbidden');
select u.as_admin('["shop"]'::jsonb);
select u.expect('админ shop без economy: admin_adjust_balance', format($$select admin_adjust_balance(%L, 100000, 'hack')$$, (select id from u.tok where nick = 'u_bob')), 'forbidden');
select u.check('админ shop: меняет описание товара', u.rows($sql$update products set description = 'ok' where slug = 'u-sword'$sql$) = 1);
select u.su(); select u.check('цена товара не изменилась у ограниченного админа', (select price_coins = 100 from products where slug = 'u-sword'));
select u.as_admin(null);
select u.check('полный админ (без permissions): меняет товар', u.rows($sql$update products set description = 'ok2' where slug = 'u-sword'$sql$) = 1);

\echo '5. Защита полей заказа от прямой записи администратором'
select u.as_admin(null);
select u.expect('админ: прямой update price_paid', format($$update orders set price_paid = 1 where id = %L$$, u.oid(current_setting('u.req_sword')::uuid)), 'orders_immutable_fields');
select u.expect('админ: прямой update player_id', format($$update orders set player_id = null where id = %L$$, u.oid(current_setting('u.req_sword')::uuid)), 'orders_immutable_fields');
select u.expect('админ: прямой update fulfillment_status', format($$update orders set fulfillment_status = 'fulfilled' where id = %L$$, u.oid(current_setting('u.req_sword')::uuid)), 'fulfillment_fields_protected');
select u.expect('админ: прямой update fulfillment_attempts', format($$update orders set fulfillment_attempts = 5 where id = %L$$, u.oid(current_setting('u.req_sword')::uuid)), 'fulfillment_fields_protected');
select u.expect('админ: прямой update refunded_at', format($$update orders set refunded_at = now() where id = %L$$, u.oid(current_setting('u.req_sword')::uuid)), 'orders_immutable_fields');

\echo '6. Выдача: ошибка -> безопасный повтор -> успех (без двойной выдачи и без возврата)'
select u.as_admin(null);
select set_config('u.o_sword', u.oid(current_setting('u.req_sword')::uuid)::text, false);
select u.expect('неизвестное действие', format($$select admin_fulfillment_step(%L, 'hack')$$, current_setting('u.o_sword')), 'invalid_action');
select u.expect('заказ без оплаты не найден', $$select admin_fulfillment_step(gen_random_uuid(), 'start')$$, 'order_not_found');
create temp table f1 as select admin_fulfillment_step(current_setting('u.o_sword')::uuid, 'start') r;
select u.check('start: processing, попытка 1', (select r->>'fulfillment_status' = 'processing' and (r->>'attempts')::int = 1 and (r->>'duplicate')::boolean = false from f1));
select u.expect('повторный start во время выдачи', format($$select admin_fulfillment_step(%L, 'start')$$, current_setting('u.o_sword')), 'already_processing');
select u.expect('возврат во время выдачи запрещён (order_processing)', format($$update orders set status = 'rejected' where id = %L$$, current_setting('u.o_sword')), 'order_processing');
select u.expect('fail без причины', format($$select admin_fulfillment_step(%L, 'fail')$$, current_setting('u.o_sword')), 'note_required');
select u.expect('слишком длинная причина', format($$select admin_fulfillment_step(%L, 'fail', repeat('x', 501))$$, current_setting('u.o_sword')), 'note_too_long');
create temp table f2 as select admin_fulfillment_step(current_setting('u.o_sword')::uuid, 'fail', 'сервер был выключен') r;
select u.check('fail: failed, попыток 1, баланс игрока не менялся', (select r->>'fulfillment_status' = 'failed' and (r->>'attempts')::int = 1 from f2) and u.bal('u_alice') = 1400);
create temp table f3 as select admin_fulfillment_step(current_setting('u.o_sword')::uuid, 'start') r;
select u.check('повтор после ошибки: processing, попытка 2', (select r->>'fulfillment_status' = 'processing' and (r->>'attempts')::int = 2 from f3));
create temp table f4 as select admin_fulfillment_step(current_setting('u.o_sword')::uuid, 'done', 'выдано в игре') r;
select u.check('done: completed/fulfilled, не дубль', (select r->>'status' = 'completed' and r->>'fulfillment_status' = 'fulfilled' and (r->>'duplicate')::boolean = false from f4));
create temp table f5 as select admin_fulfillment_step(current_setting('u.o_sword')::uuid, 'done') r;
select u.check('повторный done идемпотентен (duplicate, попыток всё ещё 2)', (select (r->>'duplicate')::boolean and (r->>'attempts')::int = 2 from f5));
create temp table f6 as select admin_fulfillment_step(current_setting('u.o_sword')::uuid, 'start') r;
select u.check('start после выдачи: duplicate, статус не изменился', (select (r->>'duplicate')::boolean and r->>'fulfillment_status' = 'fulfilled' and (r->>'attempts')::int = 2 from f6));
select u.expect('возврат после выдачи запрещён (order_fulfilled)', format($$update orders set status = 'rejected' where id = %L$$, current_setting('u.o_sword')), 'order_fulfilled');
select u.expect('возврат статуса completed -> new запрещён (повторная выдача)', format($$update orders set status = 'new' where id = %L$$, current_setting('u.o_sword')), 'order_fulfilled');
select u.expect('completed -> accepted запрещён', format($$update orders set status = 'accepted' where id = %L$$, current_setting('u.o_sword')), 'order_fulfilled');
select u.su();
select u.check('после всех попыток: баланс 1400, одно списание за товар, 0 возвратов', u.bal('u_alice') = 1400
  and (select count(*) from economy_transactions where ref_id = current_setting('u.o_sword')::uuid and kind = 'purchase') = 1
  and (select count(*) from economy_transactions where ref_id = current_setting('u.o_sword')::uuid and kind = 'refund') = 0);

\echo '7. Ошибка выдачи -> возврат: ровно один раз, без выдачи после возврата'
select u.as_player('u_alice');
select set_config('u.req_s2', gen_random_uuid()::text, false);
select shop_purchase(u.pid('sword'), current_setting('u.req_s2')::uuid, 100);
select u.check('второй меч куплен: баланс 1300', u.bal('u_alice') = 1300);
select u.as_admin(null);
select set_config('u.o_s2', u.oid(current_setting('u.req_s2')::uuid)::text, false);
select admin_fulfillment_step(current_setting('u.o_s2')::uuid, 'start');
select admin_fulfillment_step(current_setting('u.o_s2')::uuid, 'fail', 'игрок не в сети, предмет не выдан');
update orders set status = 'rejected' where id = current_setting('u.o_s2')::uuid;
select u.su();
select u.check('возврат выполнен: баланс 1400, refunded_at и refund_tx_id заполнены, fulfillment = refunded', u.bal('u_alice') = 1400
  and (select refunded_at is not null and refund_tx_id is not null and fulfillment_status = 'refunded' from orders where id = current_setting('u.o_s2')::uuid));
select u.as_admin(null);
update orders set status = 'rejected' where id = current_setting('u.o_s2')::uuid;      -- повтор: без второго возврата
select u.su();
select u.check('повторное отклонение не возвращает монеты второй раз', u.bal('u_alice') = 1400 and (select count(*) from economy_transactions where ref_id = current_setting('u.o_s2')::uuid and kind = 'refund') = 1);
select u.as_admin(null);
select u.expect('«воскресить» возвращённый заказ нельзя', format($$update orders set status = 'new' where id = %L$$, current_setting('u.o_s2')), 'order_refunded');
select u.expect('выдача по возвращённому заказу запрещена', format($$select admin_fulfillment_step(%L, 'done')$$, current_setting('u.o_s2')), 'order_refunded');

\echo '8. Возврат постоянной привилегии даёт право купить снова; чужие заказы не затрагиваются'
select u.as_admin(null);
update orders set status = 'rejected' where request_id = current_setting('u.req_vip')::uuid;
select u.su();
select u.check('возврат привилегии: баланс 1900', u.bal('u_alice') = 1900);
select u.as_player('u_alice');
select u.check('после возврата привилегию можно купить снова', (select (shop_purchase(u.pid('vip'), gen_random_uuid(), 500)->>'balance')::bigint = 1400));

\echo '9. Колесо фортуны после изменений'
select u.su();
select u.check('колесо включено и призы валидны (сумма 10000)', (select enabled from wheel_settings) and (select sum(chance_bp) = 10000 from wheel_prizes));
select u.as_player('u_wheel');
create temp table w1 as select wheel_spin() r;
select u.su();
select u.check('спин: баланс = приз, приз из настроенного списка, запись в журнале и в wheel_spins', (select (r->>'balance')::bigint = (r->>'prize_amount')::bigint
    and (r->>'prize_amount')::bigint in (select amount from wheel_prizes) from w1)
  and u.bal('u_wheel') = (select (r->>'prize_amount')::bigint from w1)
  and (select count(*) from wheel_spins where id = (select (r->>'spin_id')::uuid from w1)) = 1
  and (select count(*) from economy_transactions where ref_id = (select (r->>'spin_id')::uuid from w1) and kind = 'wheel_win') = 1);
select u.as_player('u_wheel');
select u.expect('второй спин сразу: кулдаун', $$select wheel_spin()$$, 'wheel_cooldown');
select u.su();
select u.check('после отказа баланс не изменился, спин один', u.bal('u_wheel') = (select (r->>'prize_amount')::bigint from w1) and (select count(*) from wheel_spins s join player_accounts a on a.id = s.player_id where a.nickname = 'u_wheel') = 1);

\echo '10. Инварианты'
select u.su();
select u.check('баланс ни у кого не отрицателен', (select count(*) = 0 from player_balances where balance < 0));
select u.check('баланс = сумма транзакций (тестовые игроки)', (select bool_and(b.balance = (select coalesce(sum(amount), 0) from economy_transactions x where x.player_id = b.player_id)) from player_balances b join player_accounts a on a.id = b.player_id where a.nickname like 'u\_%'));
select u.check('у каждого оплаченного заказа ровно одно списание', (select count(*) = 0 from orders o where o.price_paid is not null and o.player_id in (select id from u.tok) and (select count(*) from economy_transactions x where x.ref_id = o.id and x.kind = 'purchase') <> 1));
select u.check('возвратов не больше, чем отклонённых оплаченных заказов', (select count(*) from economy_transactions x where x.kind = 'refund' and x.player_id in (select id from u.tok)) = (select count(*) from orders o where o.status = 'rejected' and o.price_paid is not null and o.player_id in (select id from u.tok)));
select u.check('выданных (fulfilled) заказов без статуса completed нет', (select count(*) = 0 from orders where fulfillment_status = 'fulfilled' and status <> 'completed'));

\echo ''
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from u.res \gset
select format('Итого: %s успешно, %s с ошибкой', :passed, :failed) as "Результат";
select name as "ПРОВАЛЕНО" from u.res where not ok;
select :failed = 0 as all_ok \gset
\if :all_ok
\else
\quit 1
\endif
