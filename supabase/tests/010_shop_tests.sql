-- Тесты миграции 010 (покупки за монеты). Запуск на чистой тестовой базе с заглушками Supabase (см. README.md в этой папке),
-- после применения миграций 001–010:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/010_shop_tests.sql
-- Итог печатается в конце; код возврата psql = 1, если хотя бы одна проверка не прошла.
-- Не запускайте на рабочей базе: скрипт создаёт тестовых игроков и товары.
\set ON_ERROR_STOP on
\pset pager off

drop schema if exists t cascade;
create schema t;
grant usage on schema t to public;
create table t.res (name text, ok boolean);
create table t.tok (nick text primary key, id uuid, token text);
create table t.ids (k text primary key, v uuid);
grant all on all tables in schema t to public;

create function t.check(p_name text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into t.res values (p_name, coalesce(p_cond, false));
  if not coalesce(p_cond, false) then raise warning 'FAIL: %', p_name; end if;
end $$;
-- Выполняет запрос от текущей роли и проверяет, что он упал с ошибкой, содержащей code.
create function t.expect(p_name text, p_sql text, p_code text) returns void language plpgsql as $$
declare m text;
begin
  begin execute p_sql; m := null; exception when others then m := sqlerrm; end;
  perform t.check(p_name || ' -> ' || p_code, m is not null and (position(p_code in m) > 0 or (p_code = 'forbidden' and m like '%permission denied%')));
  if m is null or position(p_code in m) = 0 then raise warning '   получено: %', m; end if;
end $$;
create function t.su() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false); perform set_config('request.headers', '', false); reset role;
end $$;
create function t.as_player(p_nick text) returns void language plpgsql as $$
begin
  perform t.su();
  perform set_config('request.headers', json_build_object('x-player-token', (select token from t.tok where nick = p_nick))::text, false);
  set role anon;
end $$;
create function t.as_admin() returns void language plpgsql as $$
begin
  perform t.su();
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'adm@test', 'app_metadata', json_build_object('role', 'admin'))::text, false);
  set role authenticated;
end $$;
create function t.pid(p_k text) returns uuid language sql stable as $$ select v from t.ids where k = p_k $$;
create function t.bal(p_nick text) returns bigint language sql stable security definer as $$
  select b.balance from player_balances b join player_accounts a on a.id = b.player_id where a.nickname = p_nick $$;
grant execute on all functions in schema t to public;
-- В настоящем Supabase такие права выдаёт default privileges; в заглушке добавляем вручную. Строки по-прежнему защищены RLS и триггерами.
grant select, update on public.orders to authenticated;
grant select on public.products to anon, authenticated;

-- ---------- данные ----------
select t.su();
-- очистка остатков прошлого запуска (скрипт можно запускать повторно)
delete from orders where product_name_snapshot like 'T %' or minecraft_nickname in ('LegacyNick', 'SomeNick');
delete from products where slug like 't-%';
delete from player_accounts where nickname like 't\_%';
insert into player_accounts (nickname, password_hash, approval_status) select n, 'x', 'approved' from unnest(array['t_alice', 't_bob', 't_carol', 't_dave']) n;
insert into t.tok select a.nickname, a.id, create_player_session(a.id) from player_accounts a where a.nickname like 't\_%';
insert into minecraft_links (user_id, mc_uuid, mc_name) select id, gen_random_uuid(), 'DaveInGame' from player_accounts where nickname = 't_dave';
insert into products (name, slug, price_coins, purchase_mode, max_per_player, repurchase_cooldown_hours, is_published, is_available) values
  ('T once', 't-once', 300, 'one_time', null, null, true, true),
  ('T multi', 't-multi', 50, 'repeatable', 3, null, true, true),
  ('T cooldown', 't-cd', 10, 'repeatable', null, 24, true, true),
  ('T free', 't-free', null, 'repeatable', null, null, true, true),
  ('T hidden', 't-hidden', 10, 'repeatable', null, null, false, true),
  ('T unavailable', 't-unavail', 10, 'repeatable', null, null, true, false),
  ('T cheap', 't-cheap', 1, 'repeatable', null, null, true, true);
insert into t.ids select regexp_replace(slug, '^t-', ''), id from products where slug like 't-%';
select economy_apply((select id from t.tok where nick = 't_alice'), 1000, 'admin_credit', 'тест');
select economy_apply((select id from t.tok where nick = 't_bob'), 100, 'admin_credit', 'тест');
select economy_apply((select id from t.tok where nick = 't_carol'), 1000, 'admin_credit', 'тест');
select economy_apply((select id from t.tok where nick = 't_dave'), 500, 'admin_credit', 'тест');
-- заказ без оплаты (старый формат заявки) для проверки, что он не затрагивается
insert into orders (minecraft_nickname, product_id, product_name_snapshot, quantity) values ('LegacyNick', t.pid('free'), 'T free', 1);

\echo '1. Доступ без входа и прямые записи'
select t.su(); set role anon;
select t.expect('аноним не покупает', $$select shop_purchase(t.pid('once'), gen_random_uuid())$$, 'not_authenticated');
select t.expect('аноним не видит свои заказы', $$select * from shop_my_orders()$$, 'not_authenticated');
select t.expect('аноним не видит свои покупки', $$select shop_my_purchases()$$, 'not_authenticated');
select t.su(); select set_config('request.headers', '{"x-player-token":"' || repeat('0', 64) || '"}', false); set role anon;
select t.expect('выдуманный токен не покупает', $$select shop_purchase(t.pid('once'), gen_random_uuid())$$, 'not_authenticated');
select t.as_player('t_alice');
select t.expect('игрок не меняет баланс', $$update player_balances set balance = 999999$$, 'permission denied');
select t.expect('игрок не меняет цену товара', $$update products set price_coins = 1$$, 'permission denied');
select t.expect('игрок не создаёт заказ напрямую', $$insert into orders (minecraft_nickname, product_name_snapshot, quantity, price_paid, player_id) values ('Hack', 'x', 1, 1, null)$$, 'permission denied');
select t.expect('игрок не вызывает economy_apply', $$select economy_apply(gen_random_uuid(), 100, 'admin_credit', 'hack')$$, 'permission denied');
select t.expect('игрок не вызывает триггерную функцию возврата', $$select orders_refund_on_reject()$$, 'permission denied');

\echo '2. Успешная покупка одноразового товара'
select t.as_player('t_alice');
select set_config('t.req1', gen_random_uuid()::text, false);
create temp table r1 as select shop_purchase(t.pid('once'), current_setting('t.req1')::uuid, 300) r;
select t.check('покупка: баланс 700, статус new, цена 300, не дубль', (select (r->>'balance')::bigint = 700 and r->>'status' = 'new' and (r->>'price')::bigint = 300 and (r->>'duplicate')::boolean = false from r1));
select t.check('баланс игрока в базе 700', t.bal('t_alice') = 700);
select t.su();
select t.check('заказ: игрок, ник = логин, не подтверждён, 1 шт., оплачено 300', (select count(*) = 1 and bool_and(player_id = (select id from t.tok where nick = 't_alice') and minecraft_nickname = 't_alice' and nickname_verified = false and quantity = 1 and price_paid = 300 and status = 'new') from orders where request_id = current_setting('t.req1')::uuid));
select t.check('транзакция: purchase −300, ссылка на заказ', (select count(*) = 1 from economy_transactions x join orders o on o.id = x.ref_id and o.purchase_tx_id = x.id where o.request_id = current_setting('t.req1')::uuid and x.kind = 'purchase' and x.amount = -300 and x.balance_after = 700 and x.ref_type = 'shop_order'));

\echo '3. Повторная отправка (идемпотентность) и правила одноразовости'
select t.as_player('t_alice');
create temp table r2 as select shop_purchase(t.pid('once'), current_setting('t.req1')::uuid, 300) r;
select t.check('тот же request_id: дубль, баланс 700, тот же заказ', (select (r->>'duplicate')::boolean and (r->>'balance')::bigint = 700 and r->>'order_id' = (select r->>'order_id' from r1) from r2));
select t.su();
select t.check('после повтора по-прежнему 1 заказ и 1 списание', (select count(*) from orders where player_id = (select id from t.tok where nick='t_alice') and product_id = t.pid('once')) = 1 and (select count(*) from economy_transactions where player_id = (select id from t.tok where nick='t_alice') and kind = 'purchase') = 1);
select t.as_player('t_alice');
select t.expect('тот же request_id для другого товара', $$select shop_purchase(t.pid('multi'), current_setting('t.req1')::uuid)$$, 'invalid_request');
select t.expect('одноразовый товар нельзя купить второй раз', $$select shop_purchase(t.pid('once'), gen_random_uuid())$$, 'already_purchased');
select t.check('баланс после отказа не изменился (700)', t.bal('t_alice') = 700);

\echo '4. Недостаточно средств'
select t.as_player('t_bob');
select t.expect('баланс 100 < цена 300', $$select shop_purchase(t.pid('once'), gen_random_uuid())$$, 'insufficient_funds');
select t.check('баланс Боба не изменился и не стал отрицательным', t.bal('t_bob') = 100);
select t.su();
select t.check('заказ и транзакция не созданы', (select count(*) from orders where player_id = (select id from t.tok where nick='t_bob')) = 0 and (select count(*) from economy_transactions where player_id = (select id from t.tok where nick='t_bob') and kind = 'purchase') = 0);

\echo '5. Цена: сервер сам берёт цену, изменение цены замечается'
select t.as_player('t_alice');
select t.expect('игрок видел устаревшую цену', $$select shop_purchase(t.pid('multi'), gen_random_uuid(), 1)$$, 'price_changed');
select t.check('при price_changed ничего не списано', t.bal('t_alice') = 700);
select t.su(); update products set price_coins = 60 where slug = 't-multi';
select t.as_player('t_alice');
select t.expect('цена выросла после просмотра', $$select shop_purchase(t.pid('multi'), gen_random_uuid(), 50)$$, 'price_changed');
select t.su(); update products set price_coins = 50 where slug = 't-multi';
select t.as_player('t_alice');
select t.check('верная цена: списано ровно 50', (select (shop_purchase(t.pid('multi'), gen_random_uuid(), 50)->>'balance')::bigint) = 650);
select t.check('без expected_price цена всё равно берётся из базы (−50)', (select (shop_purchase(t.pid('multi'), gen_random_uuid())->>'balance')::bigint) = 600);

\echo '6. Лимит покупок на игрока'
select t.check('третья покупка multi проходит', (select (shop_purchase(t.pid('multi'), gen_random_uuid())->>'balance')::bigint) = 550);
select t.expect('четвёртая покупка: лимит 3', $$select shop_purchase(t.pid('multi'), gen_random_uuid())$$, 'purchase_limit');
select t.as_player('t_carol');
select t.check('у другого игрока лимит считается отдельно', (select (shop_purchase(t.pid('multi'), gen_random_uuid())->>'balance')::bigint) = 950);

\echo '7. Пауза между покупками'
select t.as_player('t_bob');
select t.check('первая покупка cd', (select (shop_purchase(t.pid('cd'), gen_random_uuid())->>'balance')::bigint) = 90);
select t.expect('вторая покупка в течение 24 ч', $$select shop_purchase(t.pid('cd'), gen_random_uuid())$$, 'purchase_cooldown');
select t.su(); update orders set created_at = now() - interval '25 hours' where product_id = t.pid('cd');
select t.as_player('t_bob');
select t.check('через 25 часов можно снова', (select (shop_purchase(t.pid('cd'), gen_random_uuid())->>'balance')::bigint) = 80);
select t.check('shop_my_purchases: 2 покупки cd и время следующей', (select (i->>'purchases')::int = 2 and i->>'next_at' is not null from jsonb_array_elements(shop_my_purchases()->'items') i where i->>'product_id' = t.pid('cd')::text));

\echo '8. Недоступные товары и обычные заявки'
select t.as_player('t_carol');
select t.expect('товар без цены', $$select shop_purchase(t.pid('free'), gen_random_uuid())$$, 'not_for_sale');
select t.expect('скрытый товар', $$select shop_purchase(t.pid('hidden'), gen_random_uuid())$$, 'product_unavailable');
select t.expect('недоступный товар', $$select shop_purchase(t.pid('unavail'), gen_random_uuid())$$, 'product_unavailable');
select t.expect('несуществующий товар', $$select shop_purchase(gen_random_uuid(), gen_random_uuid())$$, 'product_unavailable');
select t.expect('пустой request_id', $$select shop_purchase(t.pid('cheap'), null)$$, 'invalid_request');
select t.as_player('t_carol'); -- заявки может подавать и аноним
select t.su(); set role anon;
select t.expect('заявка на товар с ценой отклоняется (платный предмет не заказать бесплатно)', $$select create_order(t.pid('once'), 'SomeNick', 1, null)$$, 'priced_product');
select t.check('заявка на товар без цены работает как раньше', create_order(t.pid('free'), 'SomeNick', 1, 'тест') > 0);

\echo '9. Ник для выдачи'
select t.as_player('t_dave');
select t.check('покупка дав: ок', (select (shop_purchase(t.pid('cheap'), gen_random_uuid())->>'balance')::bigint) = 499);
select t.check('ник выдачи = подтверждённый Minecraft-ник', (select minecraft_nickname = 'DaveInGame' and nickname_verified from shop_my_orders() limit 1));

\echo '10. Личные данные покупок'
select t.as_player('t_alice');
select t.check('Алиса видит 4 своих оплаченных заказа', (select count(*) from shop_my_orders()) = 4);
select t.as_player('t_bob');
select t.check('Боб видит только свои (2)', (select count(*) from shop_my_orders()) = 2 and (select bool_and(product_name <> 'T once') from shop_my_orders()));
select t.check('заявки без оплаты в списке покупок не показываются', (select bool_and(price > 0) from shop_my_orders()));

\echo '11. Администратор: отклонение заказа возвращает монеты ровно один раз'
select t.su();
select t.check('до отклонения баланс Алисы 550', t.bal('t_alice') = 550);
select t.as_admin();
select t.expect('админ не меняет цену в заказе', $$update orders set price_paid = 1 where product_id = t.pid('once')$$, 'orders_immutable_fields');
select t.expect('админ не меняет игрока в заказе', $$update orders set player_id = null where product_id = t.pid('once')$$, 'orders_immutable_fields');
select t.expect('админ не подделывает возврат', $$update orders set refunded_at = now() where product_id = t.pid('once')$$, 'orders_immutable_fields');
select t.expect('админ не меняет ник в заказе', $$update orders set minecraft_nickname = 'Other' where product_id = t.pid('once')$$, 'orders_immutable_fields');
update orders set status = 'accepted' where product_id = t.pid('once');
select t.check('статус accepted не возвращает монеты', t.bal('t_alice') = 550);
update orders set status = 'rejected' where product_id = t.pid('once');
select t.check('отклонение вернуло 300: баланс 850', t.bal('t_alice') = 850);
select t.su();
select t.check('в журнале одна запись refund +300, связана с заказом', (select count(*) = 1 from economy_transactions x join orders o on o.id = x.ref_id and o.refund_tx_id = x.id where x.kind = 'refund' and x.amount = 300 and o.product_id = t.pid('once') and o.refunded_at is not null));
select t.as_admin();
select t.expect('нельзя вернуть отклонённый (возвращённый) заказ в работу', $$update orders set status = 'completed' where product_id = t.pid('once')$$, 'order_refunded');
update orders set status = 'rejected' where product_id = t.pid('once');   -- повторная отметка «отклонён» ничего не меняет
select t.check('повторное отклонение не начисляет второй раз', t.bal('t_alice') = 850);
update orders set status = 'rejected' where minecraft_nickname = 'LegacyNick';
select t.su();
select t.check('отклонение заявки без оплаты не создаёт возврат', (select count(*) from economy_transactions x join t.tok k on k.id = x.player_id where x.kind = 'refund') = 1);
select t.as_player('t_alice');
select t.check('после возврата одноразовый товар можно купить снова', (select (shop_purchase(t.pid('once'), gen_random_uuid())->>'balance')::bigint) = 550);
select t.expect('и снова только один раз', $$select shop_purchase(t.pid('once'), gen_random_uuid())$$, 'already_purchased');
select t.check('Алиса видит отклонённый заказ как возвращённый', (select bool_or(refunded and status = 'rejected') from shop_my_orders()));
select t.su();
select t.as_admin();
update orders set status = 'completed' where product_id = t.pid('multi') and status = 'new';
select t.check('выполненный админом заказ отображается как completed', (select count(*) from orders where status = 'completed' and player_id in (select id from t.tok where nick in ('t_alice', 't_carol'))) = 4);

\echo '12. Ограничение частоты'
select t.as_player('t_carol');
do $$ begin for i in 1..9 loop perform shop_purchase(t.pid('cheap'), gen_random_uuid()); end loop; end $$;
select t.expect('11-я покупка за минуту', $$select shop_purchase(t.pid('cheap'), gen_random_uuid())$$, 'rate_limited');

\echo '13. Инварианты'
select t.su();
select t.check('баланс ни у кого не отрицателен', (select count(*) from player_balances where balance < 0) = 0);
select t.check('баланс каждого тестового игрока = сумма его транзакций', (select bool_and(b.balance = (select coalesce(sum(amount), 0) from economy_transactions x where x.player_id = b.player_id)) from player_balances b join player_accounts a on a.id = b.player_id where a.nickname like 't\_%'));
select t.check('баланс после последней операции = balance_after', (select bool_and(b.balance = (select balance_after from economy_transactions x where x.player_id = b.player_id order by id desc limit 1)) from player_balances b join player_accounts a on a.id = b.player_id where a.nickname like 't\_%'));
select t.check('у каждого оплаченного заказа есть транзакция списания', (select count(*) from orders o where o.price_paid is not null and not exists (select 1 from economy_transactions x where x.id = o.purchase_tx_id and x.amount = -o.price_paid)) = 0);
select t.check('старая заявка без оплаты не изменилась (player_id и price_paid пусты)', (select count(*) = 1 from orders where minecraft_nickname = 'LegacyNick' and player_id is null and price_paid is null));

\echo ''
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.res \gset
select format('Итого: %s успешно, %s с ошибкой', :passed, :failed) as "Результат";
select name as "ПРОВАЛЕНО" from t.res where not ok;
select :failed = 0 as all_ok \gset
\if :all_ok
\else
\quit 1
\endif
