#!/usr/bin/env python3
"""Интеграционные тесты миграции 004 на реальном PostgreSQL.

Запуск: PGHOST=/tmp PGPORT=5444 PGUSER=pgu python3 supabase/tests/run_tests.py
База должна быть чистой: с заглушками схем auth/storage (см. supabase/tests/README.md) и применёнными 001–004.
Роли имитируют Supabase: set role anon|authenticated + request.jwt.claims (как делает PostgREST).
"""
import json, os, sys, uuid
import psycopg2

conn = psycopg2.connect(dbname=os.environ.get("PGDATABASE", "postgres"))
conn.autocommit = True
cur = conn.cursor()
passed = failed = 0


def run(sql, args=None):
    cur.execute(sql, args)
    return cur.fetchall() if cur.description else None


def su():
    cur.execute("reset role")
    cur.execute("select set_config('request.jwt.claims', '', false)")
    cur.execute("select set_config('request.headers', '', false)")


TOKENS = {}


def as_token(token):
    """Игрок: роль anon + токен в заголовке x-player-token (так делает PostgREST для запросов с anon-ключом)."""
    su()
    cur.execute("select set_config('request.headers', %s, false)", (json.dumps({"x-player-token": token}) if token else "{}",))
    cur.execute("set role anon")


def as_user(uid, admin=False, perms=None):
    if not admin:
        return as_token(TOKENS[str(uid)])
    su()
    meta = {}
    if admin:
        meta["role"] = "admin"
        if perms is not None:
            meta["permissions"] = perms
    claims = {"sub": str(uid), "role": "authenticated", "email": f"{uid}@mail.test", "app_metadata": meta}
    cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps(claims),))
    cur.execute("set role authenticated")


def as_anon():
    su()
    cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"role": "anon"}),))
    cur.execute("set role anon")


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def err(sql, args=None):
    """Выполняет запрос, возвращает текст ошибки (или None, если ошибки не было)."""
    try:
        run(sql, args)
        return None
    except psycopg2.Error as e:
        return (e.diag.message_primary or str(e)).strip()


def expect(name, sql, args, code):
    got = err(sql, args)
    # у роли anon нет права выполнять админские функции: это тоже отказ («permission denied» вместо «forbidden»)
    good = got is not None and (code in got or (code == "forbidden" and "permission denied" in got))
    check(f"{name} -> {code}", good, f"(получено: {got})")


def new_user(email, admin=False):
    """admin=True: пользователь Supabase Auth с ролью; иначе игрок (player_accounts) с готовой сессией."""
    su()
    uid = uuid.uuid4()
    if admin:
        run("insert into auth.users (id, email, raw_app_meta_data) values (%s, %s, %s)", (str(uid), email, json.dumps({"role": "admin"})))
    else:
        run("insert into player_accounts (id, nickname, password_hash, approval_status) values (%s, %s, 'x', 'approved')", (str(uid), email.split("@")[0]))
        TOKENS[str(uid)] = run("select create_player_session(%s)", (str(uid),))[0][0]
    return uid


# ---------------------------------------------------------------- подготовка
su()
SECRET = "k" * 40
run("insert into minecraft_plugin_keys (label, key_hash) values ('test', sha256(convert_to(%s, 'UTF8')))", (SECRET,))
alice, bob, carol, dave = (new_user(f"{n}@mail.test") for n in ("alice", "bob", "carol", "dave"))
adm1 = new_user("admin1@mail.test", True)   # полный
adm2 = new_user("admin2@mail.test", True)   # только moderate
adm3 = new_user("admin3@mail.test", True)   # только audit
adm4 = new_user("admin4@mail.test", True)   # только mutes
P2, P3, P4 = ["moderate"], ["audit"], ["mutes"]
UA, UB = str(uuid.uuid4()), str(uuid.uuid4())

print("1. Доступ без входа и прямые записи")
as_anon()
expect("anon не читает таблицу reviews", "select * from reviews", None, "permission denied")
expect("anon без токена не публикует отзыв", "select submit_review(5, 'xxxxxxxxxxxx')", None, "not_authenticated")
expect("anon не вызывает admin_counters", "select admin_counters()", None, "permission denied")
expect("anon не читает ключи плагина", "select * from minecraft_plugin_keys", None, "permission denied")
expect("anon не читает журнал", "select * from mute_audit", None, "permission denied")
expect("anon не читает пароли игроков", "select * from player_accounts", None, "permission denied")
expect("anon не читает сессии", "select * from player_sessions", None, "permission denied")
check("anon читает публичное представление", run("select count(*) from public_reviews")[0][0] == 0)
cols = [d[0] for d in (cur.execute("select * from public_reviews limit 0") or cur.description)]
check("в публичном представлении нет user_id/moderated_by/status", not ({"user_id", "moderated_by", "status"} & set(cols)), str(cols))
as_user(alice)
expect("игрок не пишет в reviews напрямую", "insert into reviews (author_name, rating, body, status) values ('x', 5, 'hello world 123', 'approved')", None, "permission denied")
expect("игрок не пишет в site_mutes", "insert into site_mutes (user_id, issued_by, issued_by_name, reason, duration_key) values (gen_random_uuid(), gen_random_uuid(), 'x', 'abc', 'permanent')", None, "permission denied")
expect("игрок не вызывает admin_issue_mute", "select admin_issue_mute(%s, '1h', 'reason')", (str(bob),), "forbidden")
expect("игрок не вызывает admin_lift_mute", "select admin_lift_mute(gen_random_uuid())", None, "forbidden")
expect("игрок не вызывает admin_reply_review", "select admin_reply_review(gen_random_uuid(), 'hello')", None, "forbidden")
expect("игрок не видит журнал", "select * from admin_audit_log()", None, "forbidden")
expect("игрок не видит счётчики", "select admin_counters()", None, "forbidden")
expect("игрок не читает mute_audit напрямую", "select count(*) from mute_audit", None, "permission denied")
expect("игрок не читает player_accounts напрямую", "select * from player_accounts", None, "permission denied")
su()
cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": str(alice), "role": "authenticated", "user_metadata": {"role": "admin"}, "app_metadata": {}}),))
cur.execute("set role authenticated")
expect("user_metadata.role=admin не даёт прав", "select admin_counters()", None, "forbidden")

print("2. Отзывы: создание и валидация")
as_user(alice)
expect("без профиля", "select submit_review(5, 'Отличный сервер, всем советую')", None, "profile_required")
expect("плохой ник", "select save_profile('a b')", None, "invalid_nickname")
run("select save_profile('Alice_MC')")
expect("рейтинг 6", "select submit_review(6, 'Отличный сервер, всем советую')", None, "invalid_rating")
expect("рейтинг 0", "select submit_review(0, 'Отличный сервер, всем советую')", None, "invalid_rating")
expect("короткий текст", "select submit_review(5, 'ok')", None, "body_too_short")
expect("длинный текст", "select submit_review(5, %s)", ("a" * 1001,), "body_too_long")
expect("ссылки запрещены", "select submit_review(5, 'заходи на https://evil.example сервер')", None, "links_not_allowed")
expect("ссылки www запрещены", "select submit_review(5, 'заходи на WWW.evil.example сервер')", None, "links_not_allowed")
expect("управляющие символы", "select submit_review(5, %s)", ("текст с \x07 символом тут",), "invalid_characters")
rid = run("select submit_review(5, '  Отличный сервер, всем советую  ')")[0][0]
check("отзыв создан", rid is not None)
expect("второй отзыв", "select submit_review(4, 'Ещё один отзыв от меня же')", None, "review_exists")
my = run("select my_review()")[0][0]
check("my_review: pending, текст обрезан", my["status"] == "pending" and my["body"] == "Отличный сервер, всем советую")
as_anon()
check("pending не виден публично", run("select count(*) from public_reviews")[0][0] == 0)
check("pending не попадает в статистику", run("select total from public_review_stats")[0][0] == 0)

print("3. Модерация")
as_user(alice)
expect("игрок не модерирует", "select admin_moderate_review(%s, 'approved')", (rid,), "forbidden")
as_user(adm4, True, P4)
expect("админ без moderate не модерирует", "select admin_moderate_review(%s, 'approved')", (rid,), "forbidden")
as_user(adm2, True, P2)
expect("плохой статус", "select admin_moderate_review(%s, 'published')", (rid,), "invalid_status")
expect("нет отзыва", "select admin_moderate_review(gen_random_uuid(), 'approved')", None, "review_not_found")
run("select admin_moderate_review(%s, 'approved')", (rid,))
check("moderated_by берётся с сервера",
      (su(), run("select moderated_by from reviews where id=%s", (rid,))[0][0])[1] == str(adm2))
as_anon()
pub = run("select author_name, is_verified, rating, reply_body from public_reviews")
check("approved виден; без подтверждения", len(pub) == 1 and pub[0][1] is False and pub[0][0] == "Alice_MC", str(pub))
st = run("select total, average, s5 from public_review_stats")[0]
check("статистика: 1 отзыв, 5.00", st[0] == 1 and float(st[1]) == 5.0 and st[2] == 1)

print("4. Подтверждение Minecraft-аккаунта")
as_user(alice)
code = run("select create_link_code()")[0][0]["code"]
check("формат кода XXXX-XXXX", len(code) == 9 and code[4] == "-")
expect("частый запрос кода", "select create_link_code()", None, "rate_limited")
as_anon()
check("неверный секрет", run("select confirm_minecraft_link('bad', %s, %s, 'AliceMC')", (code, UA))[0][0] == "invalid_secret")
check("короткий секрет", run("select confirm_minecraft_link('short', %s, %s, 'AliceMC')", (code, UA))[0][0] == "invalid_secret")
check("секрет-nul", run("select confirm_minecraft_link(null, %s, %s, 'AliceMC')", (code, UA))[0][0] == "invalid_secret")
check("неверный код", run("select confirm_minecraft_link(%s, 'ZZZZ-ZZZZ', %s, 'AliceMC')", (SECRET, UA))[0][0] == "invalid_code")
check("мусор вместо кода", run("select confirm_minecraft_link(%s, 'abc', %s, 'AliceMC')", (SECRET, UA))[0][0] == "invalid_code")
check("плохой ник игрока", run("select confirm_minecraft_link(%s, %s, %s, 'a b')", (SECRET, code, UA))[0][0] == "invalid_player")
as_anon()
check("значок не появился без подтверждения", run("select is_verified from public_reviews")[0][0] is False)
check("подтверждение (код в нижнем регистре, без дефиса)", run("select confirm_minecraft_link(%s, %s, %s, 'AliceMC')", (SECRET, code.lower().replace("-", ""), UA))[0][0] == "ok")
check("код одноразовый", run("select confirm_minecraft_link(%s, %s, %s, 'AliceMC')", (SECRET, code, UA))[0][0] == "invalid_code")
pub = run("select author_name, is_verified from public_reviews")[0]
check("значок подтверждения + ник из Minecraft", pub == ("AliceMC", True), str(pub))
as_user(alice)
acc = run("select my_account()")[0][0]
check("my_account: verified", acc["verified"] and acc["mc_name"] == "AliceMC" and acc["nickname"] == "Alice_MC" and not acc["is_admin"])
su(); run("update minecraft_link_codes set expires_at = now() - interval '1 second'")  # на случай остатков
as_user(bob); run("select save_profile('Bob_MC')")
bcode = run("select create_link_code()")[0][0]["code"]
as_anon()
check("UUID уже занят другим аккаунтом", run("select confirm_minecraft_link(%s, %s, %s, 'AliceMC')", (SECRET, bcode, UA))[0][0] == "uuid_taken")
su(); run("delete from minecraft_link_codes where user_id=%s", (str(bob),))
run("insert into minecraft_link_codes (user_id, code_hash, expires_at) values (%s, sha256(convert_to('ABCDEFGH','UTF8')), now() - interval '1 minute')", (str(bob),))
as_anon()
check("просроченный код", run("select confirm_minecraft_link(%s, 'ABCD-EFGH', %s, 'BobMC')", (SECRET, UB))[0][0] == "expired_code")
check("просроченный код удалён", (su(), run("select count(*) from minecraft_link_codes where user_id=%s", (str(bob),))[0][0])[1] == 0)
as_user(bob); bcode = run("select create_link_code()")[0][0]["code"]
su(); run("update minecraft_plugin_keys set revoked_at = now()")
as_anon()
check("отозванный ключ плагина", run("select confirm_minecraft_link(%s, %s, %s, 'BobMC')", (SECRET, bcode, UB))[0][0] == "invalid_secret")
su(); run("update minecraft_plugin_keys set revoked_at = null")
as_anon()
check("Bob подтверждён после восстановления ключа", run("select confirm_minecraft_link(%s, %s, %s, 'BobMC')", (SECRET, bcode, UB))[0][0] == "ok")
as_user(bob)
expect("нельзя записать ссылку на Minecraft напрямую", "insert into minecraft_links (user_id, mc_uuid, mc_name) values (%s, gen_random_uuid(), 'Fake')", (str(bob),), "permission denied")
expect("нельзя изменить чужое подтверждение", "update minecraft_links set mc_name='Hacker'", None, "permission denied")
expect("игрок не читает minecraft_links напрямую", "select count(*) from minecraft_links", None, "permission denied")

print("5. Публичные ответы администрации")
as_user(alice)
expect("игрок не отвечает от имени админа", "select admin_reply_review(%s, 'Спасибо!')", (rid,), "forbidden")
expect("игрок не пишет в review_replies", "insert into review_replies (review_id, body, admin_id, admin_public_name) values (%s, 'x', %s, 'Admin')", (rid, str(alice)), "permission denied")
as_user(adm1, True)
expect("пустой ответ", "select admin_reply_review(%s, '   ')", (rid,), "reply_empty")
expect("слишком длинный ответ", "select admin_reply_review(%s, %s)", (rid, "a" * 1001), "reply_too_long")
expect("нет отзыва", "select admin_reply_review(gen_random_uuid(), 'hello')", None, "review_not_found")
run("select admin_reply_review(%s, 'Спасибо за отзыв!')", (rid,))
as_anon()
r = run("select reply_body, reply_admin_name, reply_created_at, reply_updated_at from public_reviews")[0]
check("ответ виден всем; имя нейтральное (не e-mail)", r[0] == "Спасибо за отзыв!" and r[1] == "Администрация" and "@" not in r[1])
as_user(adm1, True)
expect("плохое публичное имя", "select set_admin_public_name('<b>')", None, "invalid_name")
run("select set_admin_public_name('Tilli_Admin')")
check("get_admin_public_name", run("select get_admin_public_name()")[0][0] == "Tilli_Admin")
as_user(adm2, True, P2)
expect("чужой ответ править нельзя", "select admin_reply_review(%s, 'Подмена')", (rid,), "not_reply_author")
expect("чужой ответ удалять нельзя (не полный админ)", "select admin_delete_reply(%s)", (rid,), "not_reply_author")
as_user(adm1, True)
run("select pg_sleep(0.05)")
run("select admin_reply_review(%s, 'Спасибо, ждём вас снова!')", (rid,))
as_anon()
r = run("select reply_body, reply_updated_at > reply_created_at from public_reviews")[0]
check("свой ответ отредактирован, дата изменения новее", r == ("Спасибо, ждём вас снова!", True), str(r))
as_user(adm3, True, P3)
expect("админ без moderate не отвечает", "select admin_reply_review(%s, 'x')", (rid,), "forbidden")
as_user(adm1, True)
run("select admin_delete_reply(%s)", (rid,))
check("ответ удалён", (as_anon(), run("select reply_body from public_reviews")[0][0])[1] is None)
as_user(adm1, True); run("select admin_reply_review(%s, 'Новый ответ от первого админа')", (rid,))
as_user(adm2, True, P2)
check("не-автор без прав 'all' не удаляет", err("select admin_delete_reply(%s)", (rid,)) is not None)
as_user(adm1, True)
run("select admin_delete_reply(%s)", (rid,))
expect("повторное удаление отсутствующего ответа", "select admin_delete_reply(%s)", (rid,), "reply_not_found")

print("6. Редактирование и удаление своего отзыва")
as_user(alice)
run("select edit_my_review(5, 'Отличный сервер, всем советую')")
st = run("select my_review()")[0][0]["status"]
check("правка без изменений не возвращает на модерацию", st == "approved", st)
expect("правка со ссылкой", "select edit_my_review(5, 'сайт http://x.y сервера')", None, "links_not_allowed")
check("правка уходит на повторную модерацию", run("select edit_my_review(4, 'Очень хороший сервер, но бывают лаги')")[0][0] == "pending")
as_anon()
check("после правки отзыв скрыт до модерации", run("select count(*) from public_reviews")[0][0] == 0)
as_user(adm2, True, P2); run("select admin_moderate_review(%s, 'hidden')", (rid,))
as_user(alice)
expect("скрытый админом отзыв нельзя править", "select edit_my_review(5, 'Новый текст отзыва для проверки')", None, "review_hidden")
as_user(adm2, True, P2); run("select admin_moderate_review(%s, 'approved')", (rid,))
as_user(bob)
expect("нет своего отзыва", "select edit_my_review(5, 'Новый текст отзыва для проверки')", None, "review_not_found")
check("delete чужого отзыва ничего не удаляет", (run("select delete_my_review()"), (su(), run("select count(*) from reviews")[0][0])[1])[1] == 1)

print("7. Жалобы")
as_user(bob)
expect("плохая причина", "select submit_report(%s, 'hate', null)", (rid,), "invalid_reason")
expect("длинные детали", "select submit_report(%s, 'spam', %s)", (rid, "x" * 301), "details_too_long")
expect("нет отзыва", "select submit_report(gen_random_uuid(), 'spam', null)", None, "review_not_found")
run("select submit_report(%s, 'spam', 'Реклама')", (rid,))
expect("повторная жалоба", "select submit_report(%s, 'spam', null)", (rid,), "already_reported")
as_user(alice)
expect("жалоба на свой отзыв", "select submit_report(%s, 'spam', null)", (rid,), "cannot_report_own")
as_anon()
expect("жалоба без входа", "select submit_report(%s, 'spam', null)", (rid,), "not_authenticated")
as_user(bob)
expect("игрок не читает жалобы", "select admin_list_reports()", None, "forbidden")
as_user(adm2, True, P2)
rep = run("select id, reason, status, reporter_nickname, total_count from admin_list_reports('open')")
check("жалоба в списке", len(rep) == 1 and rep[0][1] == "spam" and rep[0][3] == "Bob_MC", str(rep))
as_user(adm4, True, P4)
expect("админ без moderate не видит жалоб", "select admin_list_reports()", None, "forbidden")
as_user(adm2, True, P2)
cnt = run("select admin_counters()")[0][0]
check("счётчики: 1 жалоба", cnt["open_reports"] == 1 and cnt["pending_reviews"] == 0, str(cnt))
expect("плохой статус жалобы", "select admin_resolve_report(%s, 'open', null)", (rep[0][0],), "invalid_status")
run("select admin_resolve_report(%s, 'dismissed', 'Не нарушение')", (rep[0][0],))
expect("жалоба уже закрыта", "select admin_resolve_report(%s, 'resolved', null)", (rep[0][0],), "report_not_open")
check("счётчик жалоб обнулился", run("select admin_counters()")[0][0]["open_reports"] == 0)

print("8. Муты")
as_user(adm1, True)
expect("причина обязательна", "select admin_issue_mute(%s, '1h', '  ')", (str(alice),), "reason_required")
expect("причина слишком короткая", "select admin_issue_mute(%s, '1h', 'ab')", (str(alice),), "reason_required")
expect("срок 5m недопустим", "select admin_issue_mute(%s, '5m', 'спам в отзывах')", (str(alice),), "invalid_duration")
expect("срок null недопустим", "select admin_issue_mute(%s, null, 'спам в отзывах')", (str(alice),), "invalid_duration")
expect("нет пользователя", "select admin_issue_mute(gen_random_uuid(), '1h', 'спам в отзывах')", None, "user_not_found")
expect("id администратора не является игроком (себя)", "select admin_issue_mute(%s, '1h', 'спам в отзывах')", (str(adm1),), "user_not_found")
expect("id администратора не является игроком (чужого)", "select admin_issue_mute(%s, '1h', 'спам в отзывах')", (str(adm2),), "user_not_found")
as_user(adm2, True, P2)
expect("без права mutes нельзя", "select admin_issue_mute(%s, '1h', 'спам в отзывах')", (str(alice),), "forbidden")
as_user(adm4, True, P4)
mid = run("select admin_issue_mute(%s, '10m', 'Спам в отзывах')", (str(alice),))[0][0]
expect("повторный мут", "select admin_issue_mute(%s, '1h', 'ещё раз спам')", (str(alice),), "already_muted")
m = run("select status, remaining_seconds, duration_key, target_nickname, target_mc_name, issued_by_name from admin_list_mutes('active')")[0]
check("мут активен, осталось ≤ 600с", m[0] == "active" and 590 <= m[1] <= 600 and m[3] == "Alice_MC" and m[4] == "AliceMC", str(m))
as_user(alice)
acc = run("select my_account()")[0][0]
check("игрок видит свой мут и причину", acc["mute"]["reason"] == "Спам в отзывах" and acc["mute"]["permanent"] is False)
expect("мут блокирует правку отзыва", "select edit_my_review(5, 'Попытка обойти мут правкой')", None, "user_muted")
try:
    run("select edit_my_review(5, 'Попытка обойти мут правкой')")
except psycopg2.Error as e:
    check("detail = ISO-время окончания", (e.diag.message_detail or "").endswith("Z"), str(e.diag.message_detail))
expect("игрок не снимает свой мут", "select admin_lift_mute(%s, 'снимите')", (mid,), "forbidden")
expect("игрок не обновляет site_mutes напрямую", "update site_mutes set lifted_at = now()", None, "permission denied")
expect("игрок не удаляет site_mutes", "delete from site_mutes", None, "permission denied")
run("select delete_my_review()")
check("удаление своего отзыва при муте разрешено", (su(), run("select count(*) from reviews where id=%s", (rid,))[0][0])[1] == 0)
as_user(alice)
expect("мут блокирует новый отзыв", "select submit_review(5, 'Новый отзыв при активном муте')", None, "user_muted")

print("   выдача, обход через смену аккаунта (подтверждённый UUID)")
as_user(alice)
run("select unlink_minecraft()")
as_user(carol); run("select save_profile('Carol_MC')")
ccode = run("select create_link_code()")[0][0]["code"]
as_anon()
check("UUID освобождён после отвязки; Carol подтверждает UUID Alice", run("select confirm_minecraft_link(%s, %s, %s, 'AliceMC')", (SECRET, ccode, UA))[0][0] == "ok")
as_user(carol)
expect("мут действует по UUID на другой аккаунт", "select submit_review(5, 'Отзыв Кэрол с чужим UUID')", None, "user_muted")
as_user(adm4, True, P4)
run("select admin_lift_mute(%s, 'Досрочно, ошибочный мут')", (mid,))
expect("повторное снятие", "select admin_lift_mute(%s, null)", (mid,), "mute_not_active")
expect("снятие несуществующего", "select admin_lift_mute(gen_random_uuid(), null)", None, "mute_not_found")
as_user(carol)
rid2 = run("select submit_review(5, 'Отзыв Кэрол после снятия мута')")[0][0]
check("после снятия публикация работает", rid2 is not None)
as_user(alice)
check("Alice тоже может публиковать", run("select submit_review(3, 'Отзыв Элис без привязки после снятия')")[0][0] is not None)

print("   истечение срока и аудит")
as_user(adm1, True)
mid_b = run("select admin_issue_mute(%s, '1h', 'Оскорбления игроков')", (str(bob),))[0][0]
mid_d = run("select admin_issue_mute(%s, 'permanent', 'Рассылка рекламы')", (str(dave),))[0][0]
perm = run("select status, remaining_seconds, expires_at from admin_list_mutes('active', 'Рассылка')")[0]
check("бессрочный: активен, срока нет", perm[0] == "active" and perm[1] is None and perm[2] is None)
su(); run("update site_mutes set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id=%s", (mid_b,))
as_user(bob)
check("истёкший мут не блокирует (серверная проверка)", run("select submit_review(5, 'Отзыв Боба после истёкшего мута')")[0][0] is not None)
as_user(adm1, True)
lst = run("select status, remaining_seconds from admin_list_mutes('expired')")
check("статус expired в списке", len(lst) == 1 and lst[0][0] == "expired" and lst[0][1] is None, str(lst))
expect("истёкший нельзя снять", "select admin_lift_mute(%s, null)", (mid_b,), "mute_not_active")
for _ in range(3):
    run("select admin_list_mutes()")
ev = run("select event_type, occurred_at = expires_at, admin_name from admin_audit_log('expired')")
check("ровно одна запись 'expired', время = момент окончания, автор 'система'", len(ev) == 1 and ev[0] == ("expired", True, "система"), str(ev))
as_user(dave); run("select save_profile('Dave_MC')")
expect("бессрочный действует", "select submit_review(5, 'Отзыв Дейва при бессрочном муте')", None, "user_muted")
su(); run("update site_mutes set created_at = created_at - interval '400 days' where id=%s", (mid_d,))
as_user(dave)
expect("бессрочный действует спустя время", "select submit_review(5, 'Отзыв Дейва при бессрочном муте')", None, "user_muted")
as_user(adm1, True)
log = run("select event_type, user_id, target_nickname, admin_name, reason, duration_key, lift_reason, issued_at, expires_at, occurred_at from admin_audit_log('all')")
types = sorted(x[0] for x in log)
check("в журнале: issued×3, lifted×1, expired×1", types.count("issued") == 3 and types.count("lifted") == 1 and types.count("expired") == 1, str(types))
lifted = [x for x in log if x[0] == "lifted"][0]
check("снятие: кто, причина, срок и причина мута сохранены", lifted[3] == f"{adm4}@mail.test" and (lifted[6] == "Досрочно, ошибочный мут" and lifted[4] == "Спам в отзывах" and lifted[5] == "10m"), str(lifted))
check("поиск по журналу", len(run("select * from admin_audit_log('issued', 'Alice')")) == 1)
check("фильтр журнала по типу", all(x[0] == "lifted" for x in run("select event_type from admin_audit_log('lifted')")))
check("дата окончания у временных, null у бессрочного", any(x[5] == "permanent" and x[8] is None for x in log) and all(x[8] is not None for x in log if x[5] != "permanent"))
as_user(adm2, True, P2)
expect("админ без audit не читает журнал", "select * from admin_audit_log()", None, "forbidden")
check("и по RLS таблица пуста", run("select count(*) from mute_audit")[0][0] == 0)
as_user(adm3, True, P3)
check("админ с audit читает журнал", run("select count(*) from admin_audit_log()")[0][0] == 5)
expect("audit-админ не выдаёт муты", "select admin_issue_mute(%s, '1h', 'проверка прав')", (str(alice),), "forbidden")
as_user(adm3, True, P3)
expect("audit-админ не снимает муты", "select admin_lift_mute(%s, null)", (mid_d,), "forbidden")

print("9. Неизменяемость журнала")
as_user(adm1, True)
expect("UPDATE журнала админом", "update mute_audit set reason = 'x'", None, "permission denied")
expect("DELETE журнала админом", "delete from mute_audit", None, "permission denied")
expect("INSERT в журнал админом", "insert into mute_audit (event_type, mute_id, user_id, occurred_at) values ('issued', gen_random_uuid(), gen_random_uuid(), now())", None, "permission denied")
expect("TRUNCATE журнала админом", "truncate mute_audit", None, "permission denied")
su()
expect("UPDATE даже владельцем БД", "update mute_audit set reason = 'x'", None, "audit_immutable")
expect("DELETE даже владельцем БД", "delete from mute_audit", None, "audit_immutable")
expect("TRUNCATE даже владельцем БД", "truncate mute_audit", None, "audit_immutable")
n_before = run("select count(*) from mute_audit")[0][0]
run("delete from site_mutes where id=%s", (mid_d,))
check("журнал остаётся, даже если запись мута удалена", run("select count(*) from mute_audit")[0][0] == n_before)
run("delete from player_accounts where id=%s", (str(dave),))
check("журнал остаётся после удаления аккаунта игрока", run("select count(*) from mute_audit")[0][0] == n_before)

print("10. Поиск игроков и списки")
as_user(adm4, True, P4)
expect("короткий запрос", "select * from admin_search_players('a')", None, "query_too_short")
r = run("select nickname, verified, mc_name, email_masked, is_muted from admin_search_players('Carol')")
check("поиск по нику: подтверждён, почты нет", len(r) == 1 and r[0][1] is True and r[0][3] is None, str(r))
check("поиск по MC-нику", len(run("select * from admin_search_players('AliceMC')")) == 1)
check("поиск по MC UUID", len(run("select * from admin_search_players(%s)", (UA,))) == 1)
check("поиск по id аккаунта", len(run("select * from admin_search_players(%s)", (str(bob),))) == 1)
check("поиск по почте не работает: у игроков почты нет", len(run("select * from admin_search_players('bob@')")) == 0)
check("подстановочные символы экранированы", len(run("select * from admin_search_players('%%')")) == 0)
as_user(alice)
expect("игрок не ищет игроков", "select * from admin_search_players('bob')", None, "forbidden")
as_user(adm2, True, P2)
rv = run("select author_name, is_verified, status, is_muted, total_count from admin_list_reviews('all')")
check("список отзывов для админа с признаками", len(rv) >= 2 and any(x[1] for x in rv), str(rv))
check("фильтр по статусу", all(x[0] == "pending" for x in run("select status from admin_list_reviews('pending')")))
check("поиск по тексту", len(run("select * from admin_list_reviews('all', 'Кэрол')")) == 1)
check("пагинация", len(run("select * from admin_list_reviews('all', null, 1, 0)")) == 1)
expect("плохой фильтр", "select * from admin_list_reviews('zzz')", None, "invalid_status")
cnt = run("select admin_counters()")[0][0]
check("счётчик новых отзывов", cnt["pending_reviews"] == len(run("select * from admin_list_reviews('pending')")), str(cnt))

print("11. Каскады, удаление админом, безопасность публичных полей")
as_user(adm2, True, P2)
run("select admin_moderate_review(%s, 'approved')", (rid2,))
as_user(adm1, True); run("select admin_reply_review(%s, 'Ответ для каскада')", (rid2,))
as_user(bob); run("select submit_report(%s, 'abuse', null)", (rid2,))
as_user(adm2, True, P2)
run("select admin_delete_review(%s)", (rid2,))
su()
check("ответ и жалоба удалены вместе с отзывом", run("select (select count(*) from review_replies where review_id=%s) + (select count(*) from review_reports where review_id=%s)", (rid2, rid2))[0][0] == 0)
as_user(adm2, True, P2)
expect("повторное удаление", "select admin_delete_review(%s)", (rid2,), "review_not_found")
as_anon()
as_user(bob)
run("select edit_my_review(5, %s)", ("<script>alert(1)</script> тестовый текст",))
as_user(adm2, True, P2)
b = run("select id from admin_list_reviews('pending', 'script')")
run("select admin_moderate_review(%s, 'approved')", (b[0][0],))
as_anon()
check("текст с тегами отдаётся как есть, без обработки", any("<script>" in x[1] for x in run("select author_name, body from public_reviews")))

print("12. Аккаунты игроков: регистрация, вход, токены")
as_anon()
def reg(n, pw="password123"):
    return run("select player_register(%s, %s)", (n, pw))[0][0]
def approve(n):
    su(); run("update player_accounts set approval_status='approved' where nickname_lower=lower(%s)", (n,)); as_anon()
r = reg("Steve_Q")
tok = r.get("token")
check("регистрация: статус ok, токен 64 hex, ник с регистром", r["status"] == "ok" and len(tok) == 64 and r["nickname"] == "Steve_Q", str(r))
su()
row = run("select password_hash, nickname_lower from player_accounts where nickname='Steve_Q'")[0]
check("пароль хранится как bcrypt, не открытым текстом", row[0].startswith("$2") and "password123" not in row[0] and row[1] == "steve_q")
check("в базе только sha256 токена, не сам токен", run("select count(*) from player_sessions where encode(token_hash,'hex') = %s", (tok,))[0][0] == 0
      and run("select count(*) from player_sessions where token_hash = sha256(convert_to(%s,'UTF8'))", (tok,))[0][0] == 1)
check("профиль создан при регистрации", run("select nickname from player_profiles where user_id=(select id from player_accounts where nickname='Steve_Q')") == [("Steve_Q",)])
as_anon()
expect("слишком короткий пароль", "select player_register('Newbie_1', 'short')", None, "password_too_short")
expect("слишком длинный пароль", "select player_register('Newbie_1', %s)", ("x" * 73,), "password_too_long")
expect("плохой ник", "select player_register('a b', 'password123')", None, "invalid_nickname")
expect("короткий ник", "select player_register('ab', 'password123')", None, "invalid_nickname")
check("ник занят (регистр не важен)", reg("STEVE_q")["status"] == "nick_taken")
check("вход: неверный пароль", run("select player_login('Steve_Q', 'wrong-password')")[0][0]["status"] == "invalid_credentials")
check("вход: несуществующий ник — тот же ответ", run("select player_login('Nobody_1', 'password123')")[0][0]["status"] == "invalid_credentials")
l = run("select player_login('steve_q', 'password123')")[0][0]
check("вход по нику в любом регистре", l["status"] == "ok" and l["token"] != tok and l["nickname"] == "Steve_Q")
as_token(l["token"])
a = run("select my_account()")[0][0]
check("токен даёт доступ к аккаунту", a["nickname"] == "Steve_Q" and a["verified"] is False and a["is_admin"] is False)
check("новый игрок сразу может оставить отзыв", run("select submit_review(5, 'Регистрация только по нику, работает')")[0][0] is not None)
as_token("0" * 64)
expect("выдуманный токен не работает", "select my_account()", None, "not_authenticated")
as_token("abc")
expect("токен неверного формата не работает", "select my_account()", None, "not_authenticated")
as_token(None)
expect("без токена нет доступа", "select my_account()", None, "not_authenticated")
as_token(tok); run("select player_logout()")
expect("после выхода токен не работает", "select my_account()", None, "not_authenticated")
as_token(l["token"])
check("другая сессия того же игрока жива", run("select my_account()")[0][0]["nickname"] == "Steve_Q")
su(); run("update player_sessions set expires_at = now() - interval '1 second'")
as_token(l["token"])
expect("просроченная сессия не работает", "select my_account()", None, "not_authenticated")
as_anon()
for _ in range(7):
    run("select player_login('Steve_Q', 'password123')")
su()
check("не больше 5 одновременных сессий", run("select count(*) from player_sessions where player_id=(select id from player_accounts where nickname='Steve_Q')")[0][0] <= 5)
as_anon()
reg("Lock_Me"); approve("Lock_Me")
for _ in range(10):
    run("select player_login('Lock_Me', 'bad-password-1')")
check("после 10 неудач вход блокируется даже с верным паролем", run("select player_login('Lock_Me', 'password123')")[0][0]["status"] == "too_many_attempts")
su(); run("delete from player_login_failures")
as_anon()
for _ in range(3):
    run("select player_login('Lock_Me', 'bad-password-1')")
check("успешный вход сбрасывает счётчик неудач", run("select player_login('Lock_Me', 'password123')")[0][0]["status"] == "ok" and (su(), run("select count(*) from player_login_failures")[0][0])[1] == 0)
as_anon()
expect("игрок не вызывает create_player_session", "select create_player_session(gen_random_uuid())", None, "permission denied")
expect("игрок не вызывает player_uid", "select player_uid()", None, "permission denied")

print("13. Админ: аккаунты игроков (миграция 007)")
PM, PAU = ["mutes"], ["audit"]
as_user(alice)
expect("игрок не видит список аккаунтов", "select * from admin_list_accounts()", None, "forbidden")
expect("игрок не видит карточку", "select admin_account_detail(%s)", (str(bob),), "forbidden")
expect("игрок не сбрасывает чужой пароль", "select admin_reset_player_password(%s, 'password123')", (str(bob),), "forbidden")
as_anon()
expect("аноним не видит список аккаунтов", "select * from admin_list_accounts()", None, "permission denied")
as_user(adm3, True, PAU)
expect("админ только с audit не видит аккаунты", "select * from admin_list_accounts()", None, "forbidden")
as_user(adm4, True, PM)
check("админ с mutes видит список", len(run("select * from admin_list_accounts('all')")) >= 4)
check("админ с mutes видит карточку", run("select admin_account_detail(%s)", (str(bob),))[0][0]["nickname"] == "bob")
expect("mutes: нельзя сбросить пароль", "select admin_reset_player_password(%s, 'password123')", (str(bob),), "forbidden")
expect("mutes: нельзя завершить сессии", "select admin_revoke_player_sessions(%s)", (str(bob),), "forbidden")
expect("mutes: нельзя отвязать Minecraft", "select admin_unlink_player_minecraft(%s)", (str(bob),), "forbidden")
expect("mutes: нельзя удалить аккаунт", "select admin_delete_player(%s, 'bob', false)", (str(bob),), "forbidden")
expect("mutes: нельзя читать журнал действий", "select * from admin_account_actions()", None, "forbidden")
as_user(adm2, True, P2)
check("админ с moderate видит список", len(run("select * from admin_list_accounts('all')")) >= 4)
expect("moderate: нельзя удалить аккаунт", "select admin_delete_player(%s, 'bob', false)", (str(bob),), "forbidden")

as_user(adm1, True)
rows = run("select nickname, verified, total_count from admin_list_accounts('all', null, 2, 0)")
check("пагинация: 2 строки, total_count больше", len(rows) == 2 and rows[0][2] > 2, str(rows))
check("фильтр verified", all(x[0] for x in run("select verified from admin_list_accounts('verified')")) and len(run("select * from admin_list_accounts('verified')")) >= 1)
check("фильтр unverified", all(not x[0] for x in run("select verified from admin_list_accounts('unverified')")))
expect("плохой фильтр", "select * from admin_list_accounts('zzz')", None, "invalid_status")
expect("короткий запрос", "select * from admin_list_accounts('all', 'a')", None, "query_too_short")
check("поиск по нику (и по Minecraft-нику) без учёта регистра", {x[0] for x in run("select nickname from admin_list_accounts('all', 'ALICE')")} == {"alice", "carol"})
check("поиск по подстановочным символам экранирован", len(run("select * from admin_list_accounts('all', '%%')")) == 0)
check("поиск по id", len(run("select * from admin_list_accounts('all', %s)", (str(bob),))) == 1)
check("поиск по Minecraft UUID", len(run("select * from admin_list_accounts('all', %s)", (UB,))) == 1)
mid_b2 = run("select admin_issue_mute(%s, 'permanent', 'Проверка фильтра мутов')", (str(bob),))[0][0]
check("фильтр muted", [x[0] for x in run("select nickname from admin_list_accounts('muted')")] == ["bob"])
run("select admin_lift_mute(%s, null)", (mid_b2,))
d = run("select admin_account_detail(%s)", (str(bob),))[0][0]
txt = json.dumps(d)
check("в карточке нет хэша пароля и токенов", "password" not in txt.lower() and "token" not in txt.lower() and "$2" not in txt)
check("карточка: Minecraft, сессии, мут-история", d["minecraft"]["mc_name"] == "BobMC" and "count" in d["sessions"] and len(d["mutes"]) >= 1, txt[:300])
expect("карточка несуществующего", "select admin_account_detail(gen_random_uuid())", None, "player_not_found")

as_anon()
reg("Reset_Me", "OldPassw0rd1"); approve("Reset_Me")
old_tok = run("select player_login('Reset_Me', 'OldPassw0rd1')")[0][0]["token"]
l2 = run("select player_login('Reset_Me', 'OldPassw0rd1')")[0][0]
for _ in range(10):
    run("select player_login('Reset_Me', 'wrong-password-1')")
su(); rm_id = run("select id from player_accounts where nickname='Reset_Me'")[0][0]
as_user(adm1, True)
expect("новый пароль слишком короткий", "select admin_reset_player_password(%s, 'short')", (rm_id,), "password_too_short")
expect("несуществующий игрок", "select admin_reset_player_password(gen_random_uuid(), 'password123')", None, "player_not_found")
run("select admin_reset_player_password(%s, 'NewPassw0rd2')", (rm_id,))
as_anon()
check("старый пароль не подходит", run("select player_login('Reset_Me', 'OldPassw0rd1')")[0][0]["status"] == "invalid_credentials")
nl = run("select player_login('Reset_Me', 'NewPassw0rd2')")[0][0]
check("новый пароль подходит (блокировка за неудачи снята)", nl["status"] == "ok")
as_token(old_tok)
expect("старые сессии завершены после сброса", "select my_account()", None, "not_authenticated")
su()
check("хэш сменился и это bcrypt", run("select password_hash from player_accounts where id=%s", (rm_id,))[0][0].startswith("$2"))
as_user(adm1, True)
n = run("select admin_revoke_player_sessions(%s)", (rm_id,))[0][0]
check("завершение сессий: удалено ≥ 1", n >= 1)
as_token(nl["token"])
expect("сессия после завершения не работает", "select my_account()", None, "not_authenticated")

as_anon()
nl = run("select player_login('Reset_Me', 'NewPassw0rd2')")[0][0]
as_token(nl["token"]); ccode = run("select create_link_code()")[0][0]["code"]
as_anon()
check("привязка Minecraft для проверки отвязки", run("select confirm_minecraft_link(%s, %s, gen_random_uuid(), 'ResetMC')", (SECRET, ccode))[0][0] == "ok")
as_user(adm1, True)
expect("нечего отвязывать у другого", "select admin_unlink_player_minecraft(%s)", (str(alice),), "not_linked")
run("select admin_unlink_player_minecraft(%s)", (rm_id,))
check("Minecraft отвязан", (su(), run("select count(*) from minecraft_links where user_id=%s", (rm_id,))[0][0])[1] == 0)

as_token(nl["token"])
run("select submit_review(4, 'Отзыв аккаунта перед удалением')")
as_user(adm1, True)
expect("удаление: ник не совпал", "select admin_delete_player(%s, 'Other_Nick', false)", (rm_id,), "nickname_mismatch")
expect("удаление: пустой ник", "select admin_delete_player(%s, '', false)", (rm_id,), "nickname_mismatch")
run("select admin_delete_player(%s, 'reset_me', false)", (rm_id,))
su()
check("аккаунт, сессии и профиль удалены", run("select (select count(*) from player_accounts where id=%s) + (select count(*) from player_sessions where player_id=%s) + (select count(*) from player_profiles where user_id=%s)", (rm_id, rm_id, rm_id))[0][0] == 0)
check("отзыв сохранён как «старый» (без аккаунта)", run("select count(*) from reviews where author_name='Reset_Me' and user_id is null")[0][0] == 1)
as_anon()
check("ник освободился для новой регистрации", reg("Reset_Me", "Another1234")["status"] == "ok")
reg("Del_Rev", "Another1234"); approve("Del_Rev")
dl = run("select player_login('Del_Rev', 'Another1234')")[0][0]
as_token(dl["token"]); run("select submit_review(2, 'Отзыв, который удалят вместе с аккаунтом')")
su(); dr_id = run("select id from player_accounts where nickname='Del_Rev'")[0][0]
as_user(adm1, True)
run("select admin_delete_player(%s, 'Del_Rev', true)", (dr_id,))
su()
check("удаление с отзывами: отзыв тоже удалён", run("select count(*) from reviews where author_name='Del_Rev'")[0][0] == 0)
as_user(adm1, True)
expect("повторное удаление", "select admin_delete_player(%s, 'Del_Rev', true)", (dr_id,), "player_not_found")

print("   журнал действий над аккаунтами")
as_user(adm1, True)
log = run("select action, player_nickname, admin_name, note from admin_account_actions()")
acts = sorted(x[0] for x in log)
check("в журнале все типы действий", {"password_reset", "sessions_revoked", "minecraft_unlinked", "account_deleted"} <= set(acts), str(acts))
check("в журнале указан администратор и ник", all(x[2] == "Tilli_Admin" and x[1] for x in log))
check("журнал: заметки (ResetMC, сколько отзывов)", any("ResetMC" in (x[3] or "") for x in log) and any("отзывы удалены: 1" in (x[3] or "") for x in log))
check("журнал: поиск по нику", all(x[1] == "Del_Rev" for x in run("select action, player_nickname from admin_account_actions('del_rev')")))
as_user(adm3, True, PAU)
check("админ с audit читает журнал действий", len(run("select * from admin_account_actions()")) >= 4)
as_user(adm1, True)
expect("журнал действий: UPDATE админом", "update account_actions set note='x'", None, "permission denied")
expect("журнал действий: DELETE админом", "delete from account_actions", None, "permission denied")
su()
expect("журнал действий: UPDATE владельцем", "update account_actions set note='x'", None, "audit_immutable")
expect("журнал действий: DELETE владельцем", "delete from account_actions", None, "audit_immutable")
expect("журнал действий: TRUNCATE владельцем", "truncate account_actions", None, "audit_immutable")
check("запись об удалении пережила удаление аккаунта", run("select count(*) from account_actions where action='account_deleted' and player_id not in (select id from player_accounts)")[0][0] == 2)

print("14. Ручное подтверждение регистрации (миграция 008)")
su()
check("по умолчанию ручное подтверждение выключено", run("select require_approval from registration_settings")[0][0] is False)
run("update registration_settings set require_approval = true")
as_anon()
rp = reg("Pend_Zero")
check("при включённом подтверждении регистрация даёт pending_approval без токена", rp["status"] == "pending_approval" and "token" not in rp)
check("вход до одобрения: pending_approval без токена", run("select player_login('Pend_Zero', 'password123')")[0][0]["status"] == "pending_approval")
check("вход до одобрения с неверным паролем: статус не раскрывается", run("select player_login('Pend_Zero', 'wrong-password')")[0][0]["status"] == "invalid_credentials")
reg("Pend_One"); reg("Pend_Two")
su(); p1 = run("select id from player_accounts where nickname='Pend_One'")[0][0]; p2 = run("select id from player_accounts where nickname='Pend_Two'")[0][0]
check("новый аккаунт создаётся со статусом pending", run("select approval_status from player_accounts where id=%s", (p1,))[0][0] == "pending")
check("аккаунты, созданные админом/старые строки через insert, можно задать approved", run("select count(*) from player_accounts where approval_status='approved'")[0][0] >= 4)
as_user(adm1, True)
check("счётчик pending_accounts", run("select admin_counters()")[0][0]["pending_accounts"] >= 2)
pl = run("select nickname, approval_status from admin_list_accounts('pending')")
check("фильтр pending показывает только ожидающих", len(pl) >= 2 and all(x[1] == "pending" for x in pl))
check("ожидающие идут первыми в общем списке", run("select approval_status from admin_list_accounts('all', null, 1, 0)")[0][0] == "pending")
check("карточка содержит статус регистрации", run("select admin_account_detail(%s)", (p1,))[0][0]["approval"]["status"] == "pending")
as_user(adm4, True, ["mutes"])
expect("mutes: нельзя одобрить", "select admin_approve_player(%s)", (p1,), "forbidden")
expect("mutes: нельзя отклонить", "select admin_reject_player(%s, 'причина')", (p1,), "forbidden")
as_anon()
expect("аноним не одобряет", "select admin_approve_player(%s)", (p1,), "permission denied")
as_user(alice)
expect("игрок не одобряет", "select admin_approve_player(%s)", (p1,), "forbidden")
as_user(adm1, True)
expect("отклонение без причины", "select admin_reject_player(%s, '')", (p1,), "reason_required")
run("select admin_approve_player(%s)", (p1,))
expect("повторное одобрение", "select admin_approve_player(%s)", (p1,), "already_approved")
as_anon()
lg = run("select player_login('Pend_One', 'password123')")[0][0]
check("после одобрения вход выдаёт токен", lg["status"] == "ok" and len(lg["token"]) == 64)
as_token(lg["token"])
check("токен одобренного работает", run("select my_account()")[0][0]["nickname"] == "Pend_One")
as_user(adm1, True)
run("select admin_reject_player(%s, 'Не похоже на игрока сервера')", (p1,))
expect("повторное отклонение", "select admin_reject_player(%s, 'ещё раз')", (p1,), "already_rejected")
as_token(lg["token"])
expect("отклонение завершает активные сессии", "select my_account()", None, "not_authenticated")
as_anon()
rj = run("select player_login('Pend_One', 'password123')")[0][0]
check("отклонённый не входит и видит причину", rj["status"] == "rejected" and "игрока сервера" in rj["reason"] and "token" not in rj)
check("ник отклонённого остаётся занятым", reg("pend_one")["status"] == "nick_taken")
su()
check("сессий у отклонённого нет", run("select count(*) from player_sessions where player_id=%s", (p1,))[0][0] == 0)
run("insert into player_sessions (token_hash, player_id, expires_at) values (sha256(convert_to(%s,'UTF8')), %s, now() + interval '1 day')", ("a" * 64, p1))
as_token("a" * 64)
expect("player_uid не признаёт сессию отклонённого аккаунта", "select my_account()", None, "not_authenticated")
as_user(adm1, True)
check("фильтр rejected", [x[0] for x in run("select nickname from admin_list_accounts('rejected')")] == ["Pend_One"])
run("select admin_approve_player(%s)", (p1,))
as_anon()
check("отклонённого можно позже одобрить", run("select player_login('Pend_One', 'password123')")[0][0]["status"] == "ok")
as_user(adm1, True)
log = run("select action from admin_account_actions('pend_one')")
check("журнал: одобрение и отклонение записаны", {x[0] for x in log} >= {"account_approved", "account_rejected"})
expect("неизвестный фильтр", "select * from admin_list_accounts('bogus')", None, "invalid_status")
su()

run("insert into player_accounts (nickname, password_hash, created_at) select 'Flood_' || g, 'x', now() - interval '5 minutes' from generate_series(1, 500) g")
as_anon()
expect("лимит заявок в ожидании", "select player_register('Flood_Last', 'password123')", None, "too_many_pending")
su(); run("delete from player_accounts where nickname like 'Flood\\_%'")
run("update registration_settings set require_approval = false")
as_anon()
check("после выключения регистрация снова мгновенная", reg("Instant_1")["status"] == "ok")
su()

print("15. Экономика и колесо удачи (миграция 009)")
import threading
su()
check("у существующих и новых аккаунтов есть баланс 0", run("select count(*) from player_accounts a left join player_balances b on b.player_id=a.id where b.player_id is null")[0][0] == 0)
check("баланс при создании аккаунта равен 0", run("select balance from player_balances b join player_accounts a on a.id=b.player_id where a.nickname='Instant_1'")[0][0] == 0)
check("призы по умолчанию: 6 шт., сумма ровно 100%", run("select count(*), sum(chance_bp) from wheel_prizes")[0] == (6, 10000))
check("призы по умолчанию: 50/100/250/500/1000/2500 = 35/25/20/12/7/1", run("select string_agg(amount||':'||chance_bp, ',' order by position) from wheel_prizes")[0][0] == "50:3500,100:2500,250:2000,500:1200,1000:700,2500:100")
eco = new_user("econ_a@mail.test"); econ_b = new_user("econ_b@mail.test"); econ_c = new_user("econ_c@mail.test")
as_anon()
expect("аноним (без токена) не видит экономику", "select economy_me()", None, "not_authenticated")
expect("аноним не крутит колесо", "select wheel_spin()", None, "not_authenticated")
as_token("0" * 64)
expect("выдуманный токен не крутит колесо", "select wheel_spin()", None, "not_authenticated")
as_user(eco)
expect("игрок не читает player_balances напрямую", "select * from player_balances", None, "permission denied")
expect("игрок не пишет в player_balances", "update player_balances set balance = 999999", None, "permission denied")
expect("игрок не вставляет транзакции", "insert into economy_transactions (player_id, player_nickname, kind, amount, balance_after, reason) values (gen_random_uuid(), 'x', 'admin_credit', 1, 1, 'x')", None, "permission denied")
expect("игрок не читает журнал напрямую", "select * from economy_transactions", None, "permission denied")
expect("игрок не вызывает economy_apply", "select economy_apply(gen_random_uuid(), 100, 'admin_credit', 'hack')", None, "permission denied")
expect("игрок не меняет призы напрямую", "update wheel_prizes set amount = 1000000", None, "permission denied")
expect("игрок не вызывает админские функции", "select admin_adjust_balance(gen_random_uuid(), 100, 'hack')", None, "forbidden")
expect("игрок не вызывает admin_wheel_config", "select admin_wheel_config()", None, "forbidden")
me = run("select economy_me()")[0][0]
check("economy_me: баланс 0, колесо доступно, 6 призов", me["balance"] == 0 and me["wheel"]["can_spin"] is True and len(me["wheel"]["prizes"]) == 6 and me["wheel"]["next_spin_at"] is None)
sp = run("select wheel_spin()")[0][0]
check("спин: приз из списка, баланс = приз", sp["prize_amount"] in (50, 100, 250, 500, 1000, 2500) and sp["balance"] == sp["prize_amount"], str(sp))
check("спин: индекс приза соответствует сумме", [50, 100, 250, 500, 1000, 2500][sp["prize_index"]] == sp["prize_amount"])
me = run("select economy_me()")[0][0]
check("после спина: баланс, таймер, can_spin=false", me["balance"] == sp["prize_amount"] and me["wheel"]["can_spin"] is False and me["wheel"]["next_spin_at"] is not None)
expect("второй спин в течение 24 часов", "select wheel_spin()", None, "wheel_cooldown")
tx = run("select kind, amount, balance_after, reason from my_transactions()")
check("в журнале ровно одна запись о выигрыше", tx == [("wheel_win", sp["prize_amount"], sp["prize_amount"], "Колесо удачи")], str(tx))
check("my_spins: история спинов игрока", [(x[1], x[2]) for x in run("select * from my_spins()")] == [(sp["prize_amount"], "completed")])
su()
check("спин и транзакция связаны", run("select count(*) from wheel_spins s join economy_transactions t on t.id = s.tx_id and t.ref_id = s.id where s.id=%s", (sp["spin_id"],))[0][0] == 1)
check("таймер 24 часа (серверное время)", run("select wheel_next_spin_at(%s) - (select created_at from wheel_spins where id=%s)", (str(eco), sp["spin_id"]))[0][0].total_seconds() == 86400)
run("alter table wheel_spins disable trigger wheel_spins_no_change")
run("update wheel_spins set created_at = now() - interval '23 hours 59 minutes' where id=%s", (sp["spin_id"],))
as_user(eco)
expect("через 23:59 спин всё ещё недоступен", "select wheel_spin()", None, "wheel_cooldown")
su(); run("update wheel_spins set created_at = now() - interval '24 hours 1 minute' where id=%s", (sp["spin_id"],)); run("alter table wheel_spins enable trigger wheel_spins_no_change")
as_user(eco)
check("через 24 часа спин снова доступен", run("select economy_me()")[0][0]["wheel"]["can_spin"] is True)
sp2 = run("select wheel_spin()")[0][0]
check("второй спин начисляется поверх баланса", sp2["balance"] == sp["prize_amount"] + sp2["prize_amount"])
check("история игрока: 2 записи, у каждой свой баланс", [x[0] for x in run("select amount from my_transactions() order by id")] == [sp["prize_amount"], sp2["prize_amount"]])
as_user(econ_b)
check("игрок не видит чужие транзакции", run("select count(*) from my_transactions()")[0][0] == 0)

# параллельные запросы: из 8 одновременных спинов успешен ровно один
def conn_for(uid):
    c = psycopg2.connect(dbname=os.environ.get("PGDATABASE", "postgres")); c.autocommit = True; k = c.cursor()
    k.execute("select set_config('request.headers', %s, false)", (json.dumps({"x-player-token": TOKENS[str(uid)]}),)); k.execute("set role anon")
    return c, k
results = []
def worker(uid):
    c, k = conn_for(uid)
    try:
        k.execute("select wheel_spin()"); results.append("ok")
    except Exception as ex:
        results.append("cooldown" if "wheel_cooldown" in str(ex) else "other:" + str(ex)[:80])
    c.close()
ths = [threading.Thread(target=worker, args=(econ_c,)) for _ in range(8)]
[t.start() for t in ths]; [t.join() for t in ths]
check("8 параллельных спинов: один успех, остальные cooldown", results.count("ok") == 1 and results.count("cooldown") == 7, str(results))
su()
check("после параллельных спинов: 1 запись, 1 транзакция, баланс = приз", run("select (select count(*) from wheel_spins where player_id=%s), (select count(*) from economy_transactions where player_id=%s), (select balance from player_balances where player_id=%s) = (select amount from economy_transactions where player_id=%s)", (str(econ_c),) * 4)[0] == (1, 1, True))

# параллельные списания админом не дают отрицательный баланс
su(); run("update player_balances set balance = 100 where player_id=%s", (str(econ_b),))
def debit_worker():
    c = psycopg2.connect(dbname=os.environ.get("PGDATABASE", "postgres")); c.autocommit = True; k = c.cursor()
    claims = {"sub": str(adm1), "role": "authenticated", "email": "a@a.test", "app_metadata": {"role": "admin"}}
    k.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps(claims),)); k.execute("set role authenticated")
    try:
        k.execute("select admin_adjust_balance(%s, -60, 'параллельный тест')", (str(econ_b),)); results.append("debit_ok")
    except Exception as ex:
        results.append("debit_fail" if "insufficient_funds" in str(ex) else "other:" + str(ex)[:80])
    c.close()
results.clear()
ths = [threading.Thread(target=debit_worker) for _ in range(4)]
[t.start() for t in ths]; [t.join() for t in ths]
check("4 параллельных списания по 60 при балансе 100: одно проходит", results.count("debit_ok") == 1 and results.count("debit_fail") == 3, str(results))
su()
check("баланс = 40, неотрицательный", run("select balance from player_balances where player_id=%s", (str(econ_b),))[0][0] == 40)
run("update player_balances set balance = 0 where player_id=%s", (str(econ_b),))

# распределение призов
su(); run("alter table wheel_spins disable trigger wheel_spins_no_change")
stat = run("insert into player_accounts (nickname, password_hash, approval_status) values ('Stat_Player', 'x', 'approved') returning id")[0][0]
tokS = run("select create_player_session(%s)", (str(stat),))[0][0]
cS, kS = None, None
cS = psycopg2.connect(dbname=os.environ.get("PGDATABASE", "postgres")); cS.autocommit = True; kS = cS.cursor()
counts = {}
N = 4000
for _ in range(N):
    kS.execute("reset role"); kS.execute("delete from wheel_spins where player_id=%s", (str(stat),))
    kS.execute("select set_config('request.headers', %s, false)", (json.dumps({"x-player-token": tokS}),)); kS.execute("set role anon")
    kS.execute("select wheel_spin()"); a = kS.fetchone()[0]["prize_amount"]; counts[a] = counts.get(a, 0) + 1
cS.close()
exp = {50: .35, 100: .25, 250: .20, 500: .12, 1000: .07, 2500: .01}
ok = all(abs(counts.get(a, 0) / N - pr) < 5 * (pr * (1 - pr) / N) ** .5 for a, pr in exp.items())
check("распределение призов на 4000 спинов соответствует вероятностям (±5σ)", ok, str(counts))
su(); run("alter table wheel_spins enable trigger wheel_spins_no_change")
check("баланс игрока совпадает с суммой его транзакций", run("select b.balance = (select sum(amount) from economy_transactions where player_id=b.player_id) from player_balances b where b.player_id=%s", (str(stat),))[0][0] is True)

# админ
as_user(adm4, True, ["mutes"])
expect("право mutes не даёт управлять монетами", "select admin_adjust_balance(%s, 10, 'тест')", (str(eco),), "forbidden")
expect("право mutes не видит балансы", "select * from admin_economy_players()", None, "forbidden")
expect("право mutes не меняет призы", "select admin_set_wheel_prizes('[]'::jsonb)", None, "forbidden")
expect("право mutes не выключает колесо", "select admin_set_wheel_enabled(false)", None, "forbidden")
expect("право mutes не видит статистику", "select admin_wheel_stats()", None, "forbidden")
as_anon()
expect("аноним не вызывает admin_adjust_balance", "select admin_adjust_balance(gen_random_uuid(), 1, 'x')", None, "permission denied")
as_user(adm3, True, ["economy"])
check("админ с economy видит игроков с балансами", len(run("select * from admin_economy_players()")) >= 4)
check("поиск игрока по нику", [x[1] for x in run("select * from admin_economy_players('econ_a')")] == ["econ_a"])
expect("поиск короче 2 символов", "select * from admin_economy_players('a')", None, "query_too_short")
before = run("select balance from admin_economy_players('econ_a')")[0][0]
r = run("select admin_adjust_balance(%s, 500, 'Компенсация за ошибку')", (str(eco),))[0][0]
check("начисление админом увеличивает баланс", r["balance"] == before + 500)
r = run("select admin_adjust_balance(%s, -200, 'Штраф за нарушение')", (str(eco),))[0][0]
check("списание админом уменьшает баланс", r["balance"] == before + 300)
expect("списание больше баланса", "select admin_adjust_balance(%s, -1000000, 'слишком много')", (str(eco),), "insufficient_funds")
expect("причина обязательна", "select admin_adjust_balance(%s, 10, '')", (str(eco),), "reason_required")
expect("нулевая сумма", "select admin_adjust_balance(%s, 0, 'нулевая')", (str(eco),), "invalid_amount")
expect("сумма больше лимита", "select admin_adjust_balance(%s, 1000000001, 'много')", (str(eco),), "invalid_amount")
expect("несуществующий игрок", "select admin_adjust_balance(gen_random_uuid(), 10, 'тест')", None, "player_not_found")
check("баланс не изменился после отказов", run("select balance from admin_economy_players('econ_a')")[0][0] == before + 300)
t = run("select kind, amount, reason, admin_name from admin_economy_transactions(%s)", (str(eco),))
check("журнал: админ-начисление и списание с причиной и именем админа", ("admin_credit", 500, "Компенсация за ошибку") == t[1][:3] or ("admin_credit", 500, "Компенсация за ошибку") == t[0][:3])
check("журнал: списание отрицательное", any(x[0] == "admin_debit" and x[1] == -200 for x in t))
check("журнал: поиск по нику и общий список", len(run("select * from admin_economy_transactions(null, 'econ_a')")) >= 4 and len(run("select * from admin_economy_transactions()")) >= 4)
as_user(eco)
check("игрок видит админские операции со своей причиной", {x[0] for x in run("select reason from my_transactions()")} >= {"Компенсация за ошибку", "Штраф за нарушение"})
su()
run("update player_balances set balance = 999999999999 where player_id=%s", (str(econ_b),))
as_user(adm3, True, ["economy"])
expect("переполнение баланса", "select admin_adjust_balance(%s, 5, 'переполнение')", (str(econ_b),), "balance_overflow")
su(); run("update player_balances set balance = 0 where player_id=%s", (str(econ_b),))
expect("CHECK: отрицательный баланс невозможен даже у владельца", "update player_balances set balance = -1 where player_id=%s", (str(econ_b),), "check")
# неизменяемость
for stmt, what in [("update economy_transactions set amount = 1", "UPDATE"), ("delete from economy_transactions", "DELETE"), ("truncate economy_transactions", "TRUNCATE"),
                   ("update wheel_spins set prize_amount = 1", "UPDATE спинов"), ("delete from wheel_spins", "DELETE спинов"), ("truncate wheel_spins", "TRUNCATE спинов"),
                   ("truncate economy_admin_log", "TRUNCATE журнала настроек")]:
    expect(f"журнал неизменяем: {what}", stmt, None, "audit_immutable")
as_user(adm3, True, ["economy"])
expect("админ не правит журнал транзакций", "update economy_transactions set amount = 1", None, "permission denied")
# настройки колеса
cfg = run("select admin_wheel_config()")[0][0]
check("конфиг колеса: включено, 6 призов, сумма 10000", cfg["enabled"] is True and len(cfg["prizes"]) == 6 and cfg["total_bp"] == 10000)
bad = [("сумма не 100%", '[{"amount":10,"chance_bp":5000},{"amount":20,"chance_bp":4000}]', "chances_sum_invalid"),
       ("сумма больше 100%", '[{"amount":10,"chance_bp":6000},{"amount":20,"chance_bp":5000}]', "chances_sum_invalid"),
       ("один приз", '[{"amount":10,"chance_bp":10000}]', "prizes_invalid"),
       ("отрицательный приз", '[{"amount":-10,"chance_bp":5000},{"amount":20,"chance_bp":5000}]', "prizes_invalid"),
       ("нулевой приз", '[{"amount":0,"chance_bp":5000},{"amount":20,"chance_bp":5000}]', "prizes_invalid"),
       ("дробный приз", '[{"amount":10.5,"chance_bp":5000},{"amount":20,"chance_bp":5000}]', "prizes_invalid"),
       ("дробная вероятность", '[{"amount":10,"chance_bp":5000.5},{"amount":20,"chance_bp":4999.5}]', "prizes_invalid"),
       ("нулевая вероятность", '[{"amount":10,"chance_bp":0},{"amount":20,"chance_bp":10000}]', "prizes_invalid"),
       ("приз больше лимита", '[{"amount":2000000000,"chance_bp":5000},{"amount":20,"chance_bp":5000}]', "prizes_invalid"),
       ("строки вместо чисел", '[{"amount":"10","chance_bp":"5000"},{"amount":"20","chance_bp":"5000"}]', "prizes_invalid"),
       ("не массив", '{"amount":10}', "prizes_invalid"),
       ("13 призов", json.dumps([{"amount": 1 + i, "chance_bp": 769 if i < 12 else 772} for i in range(13)]), "prizes_invalid")]
for name, js, code in bad:
    expect(f"призы: {name}", "select admin_set_wheel_prizes(%s::jsonb)", (js,), code)
su()
check("после отказов призы не изменились", run("select count(*), sum(chance_bp) from wheel_prizes")[0] == (6, 10000))
as_user(adm3, True, ["economy"])
run("select admin_set_wheel_prizes('[{\"amount\":10,\"chance_bp\":9999},{\"amount\":777,\"chance_bp\":1}]'::jsonb)")
su(); _pr = run("select string_agg(amount||':'||chance_bp, ',' order by position) from wheel_prizes")[0][0]; as_user(adm3, True, ["economy"])
check("призы заменены (99.99% / 0.01%)", _pr == "10:9999,777:1")
run("select admin_set_wheel_enabled(false)")
as_user(econ_b)
check("игрок видит, что колесо выключено", run("select economy_me()")[0][0]["wheel"]["enabled"] is False)
expect("выключенное колесо не крутится", "select wheel_spin()", None, "wheel_disabled")
as_user(adm3, True, ["economy"])
run("select admin_set_wheel_enabled(true)")
as_user(econ_b)
sb = run("select wheel_spin()")[0][0]
check("после включения спин работает с новыми призами", sb["prize_amount"] in (10, 777))
as_user(adm3, True, ["economy"])
run("select admin_set_wheel_prizes('[{\"amount\":50,\"chance_bp\":3500},{\"amount\":100,\"chance_bp\":2500},{\"amount\":250,\"chance_bp\":2000},{\"amount\":500,\"chance_bp\":1200},{\"amount\":1000,\"chance_bp\":700},{\"amount\":2500,\"chance_bp\":100}]'::jsonb)")
check("журнал настроек колеса записан", {x["action"] for x in run("select admin_wheel_config()")[0][0]["log"]} >= {"wheel_disabled", "wheel_enabled", "prizes_changed"})
st = run("select admin_wheel_stats()")[0][0]
check("статистика: спины, выплаты, обращение, ожидание", st["total_spins"] >= 3 and st["total_paid"] > 0 and st["coins_in_circulation"] > 0 and abs(float(st["expected_per_spin"]) - 247.5) < 0.001 and len(st["by_prize"]) >= 1, str(st))
sl = run("select player_nickname, prize_amount, status from admin_wheel_spins('econ_a')")
check("история спинов админа: поиск по нику", len(sl) == 2 and all(x[2] == "completed" for x in sl))
su(); run("update wheel_prizes set chance_bp = chance_bp + 1 where position = 1")
as_user(econ_b); run("select 1")
as_user(econ_a := new_user("econ_d@mail.test"))
expect("некорректная сумма вероятностей блокирует спин", "select wheel_spin()", None, "prizes_invalid")
su(); run("update wheel_prizes set chance_bp = chance_bp - 1 where position = 1")
# удаление аккаунта
as_user(adm1, True)
run("select admin_delete_player(%s, 'econ_a', false)", (str(eco),))
su()
check("удаление аккаунта: баланс удалён, журнал и спины сохранены", run("select (select count(*) from player_balances where player_id=%s), (select count(*) from economy_transactions where player_id=%s) > 0, (select count(*) from wheel_spins where player_id=%s) > 0", (str(eco),) * 3)[0] == (0, True, True))

print(f"\nИтого: {passed} успешно, {failed} с ошибкой")
sys.exit(1 if failed else 0)
