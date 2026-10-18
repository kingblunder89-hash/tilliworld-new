// Чистые функции магазина (без побочных эффектов), покрыты тестами. Окончательные решения о покупке принимает база (shop_purchase);
// здесь только подсказки для интерфейса и перевод кодов ошибок.

// Коды ошибок SQL-функций из supabase/migrations/010_shop_purchases.sql (и economy_apply из 009).
export const SHOP_ERRORS = {
  not_authenticated: 'Войдите в аккаунт, чтобы купить предмет.',
  insufficient_funds: 'Недостаточно средств',
  product_unavailable: 'Этот предмет сейчас недоступен.',
  not_for_sale: 'Этот предмет нельзя купить за монеты.',
  price_changed: 'Цена изменилась. Проверьте новую цену и повторите покупку.',
  already_purchased: 'Этот предмет можно купить только один раз, вы его уже покупали.',
  purchase_limit: 'Достигнут лимит покупок этого предмета.',
  purchase_cooldown: 'Повторная покупка этого предмета пока недоступна.',
  rate_limited: 'Слишком много покупок за короткое время. Подождите минуту.',
  invalid_request: 'Некорректный запрос. Обновите страницу и повторите.',
  balance_overflow: 'Операцию выполнить не удалось. Обратитесь к администратору.',
}

// error: объект ошибки supabase-js ({ message, details }). Возвращает { code, message, detail }.
// code === 'network' — ответ мог не дойти: покупка могла пройти, поэтому повтор нужно отправлять с тем же request_id.
export function purchaseError(error) {
  const msg = String(error?.message ?? '')
  const code = Object.keys(SHOP_ERRORS).find((k) => msg.includes(k))
  if (code) return { code, message: SHOP_ERRORS[code], detail: error?.details ?? null }
  if (/failed to fetch|networkerror|load failed|network request failed|timeout/i.test(msg)) {
    return { code: 'network', message: 'Нет соединения с сервером. Проверьте, прошла ли покупка, в разделе «Аккаунт», или повторите: повтор не спишет монеты дважды.', detail: null }
  }
  return { code: 'unknown', message: 'Не удалось выполнить покупку. Попробуйте позже.', detail: null }
}

export const PURCHASE_MODES = { repeatable: 'Многоразовый', one_time: 'Одноразовый (один раз на аккаунт)' }

// Подсказка интерфейса: можно ли показывать активную кнопку. mine — запись из shop_my_purchases ({purchases, next_at}) или undefined.
// secondsToNext — оставшиеся секунды паузы (уже с поправкой на серверное время), 0 если паузы нет.
export function purchaseHint(product, mine, { balance = null, secondsToNext = 0 } = {}) {
  const n = Number(mine?.purchases) || 0
  if (!product.is_available) return { canBuy: false, reason: 'unavailable', text: 'Сейчас недоступно' }
  if (product.price_coins == null) return { canBuy: false, reason: 'not_for_sale', text: 'Не продаётся за монеты' }
  if (product.purchase_mode === 'one_time' && n >= 1) return { canBuy: false, reason: 'owned', text: 'Уже куплено' }
  if (product.max_per_player != null && n >= product.max_per_player) return { canBuy: false, reason: 'limit', text: 'Достигнут лимит покупок' }
  if (secondsToNext > 0) return { canBuy: false, reason: 'cooldown', text: 'Повторная покупка скоро будет доступна' }
  if (balance != null && Number(balance) < Number(product.price_coins)) return { canBuy: false, reason: 'funds', text: 'Недостаточно средств' }
  return { canBuy: true, reason: null, text: '' }
}

// Правила повторной покупки одной строкой для карточки товара (null — ограничений нет).
export function purchaseRuleText(product) {
  const parts = []
  if (product.purchase_mode === 'one_time') parts.push('Можно купить один раз')
  else if (product.max_per_player != null) parts.push(`Не более ${product.max_per_player} шт. на игрока`)
  if (product.repurchase_cooldown_hours != null) parts.push(`Повторно — не чаще, чем раз в ${product.repurchase_cooldown_hours} ч`)
  return parts.length ? parts.join('. ') + '.' : null
}

// Статусы заказа глазами игрока. «Выдан» пишется только после того, как администратор отметил заказ выполненным.
export function orderStatusForPlayer(status, refunded) {
  if (status === 'rejected') return refunded ? { label: 'Отклонён, монеты возвращены', tone: 'red' } : { label: 'Отклонён', tone: 'red' }
  if (status === 'completed') return { label: 'Выдан (подтверждено администратором)', tone: 'green' }
  if (status === 'accepted') return { label: 'Принят в работу, ещё не выдан', tone: 'amber' }
  return { label: 'Ожидает выдачи администратором', tone: 'sky' }
}

// Проверка полей товара в админ-панели. Возвращает { value, error }: value — поля для сохранения.
export function validateSaleFields({ price_coins, purchase_mode, max_per_player, repurchase_cooldown_hours }) {
  const num = (v, min, max) => {
    const t = String(v ?? '').trim()
    if (t === '') return { empty: true }
    if (!/^\d{1,10}$/.test(t)) return { bad: true }
    const n = Number(t)
    return n >= min && n <= max ? { n } : { bad: true }
  }
  const price = num(price_coins, 1, 1_000_000_000)
  if (price.bad) return { value: null, error: 'Цена: целое число монет от 1 до 1 000 000 000 (или оставьте пустым, если предмет не продаётся).' }
  if (!Object.hasOwn(PURCHASE_MODES, purchase_mode)) return { value: null, error: 'Выберите тип товара: одноразовый или многоразовый.' }
  const max = num(max_per_player, 1, 1000)
  if (max.bad) return { value: null, error: 'Лимит покупок: целое число от 1 до 1000 (или пусто — без лимита).' }
  const cd = num(repurchase_cooldown_hours, 1, 8760)
  if (cd.bad) return { value: null, error: 'Пауза между покупками: целое число часов от 1 до 8760 (или пусто — без паузы).' }
  const sold = !price.empty
  return {
    value: {
      price_coins: sold ? price.n : null,
      purchase_mode,
      // для одноразового товара лимит и пауза не имеют смысла
      max_per_player: sold && purchase_mode === 'repeatable' && !max.empty ? max.n : null,
      repurchase_cooldown_hours: sold && purchase_mode === 'repeatable' && !cd.empty ? cd.n : null,
    },
    error: null,
  }
}

// Коды ошибок админских операций над оплаченными заказами (миграция 012). Окончательные решения принимает база.
export const ORDER_ADMIN_ERRORS = {
  order_fulfilled: 'Предмет уже выдан: менять статус и возвращать монеты по этому заказу нельзя.',
  order_processing: 'Выдача в процессе. Сначала отметьте результат («Ошибка выдачи» или «Выдано»), затем отклоняйте заказ.',
  order_refunded: 'Монеты по этому заказу уже возвращены игроку: вернуть заказ в работу или выдать предмет нельзя.',
  already_processing: 'Выдача этого заказа уже идёт.',
  note_required: 'Укажите причину ошибки выдачи (не короче 3 символов).',
  note_too_long: 'Примечание слишком длинное (максимум 500 символов).',
  attempts_exceeded: 'Достигнут предел попыток выдачи. Верните монеты игроку, отклонив заказ.',
  order_not_found: 'Оплаченный заказ не найден.',
  invalid_action: 'Недопустимое действие.',
  forbidden: 'Недостаточно прав: для магазина нужно право «shop».',
  fulfillment_fields_protected: 'Поля выдачи меняются только кнопками выдачи.',
  insufficient: 'Не удалось вернуть монеты игроку.',
  overflow: 'Не удалось вернуть монеты игроку.',
}
export function orderAdminError(error) {
  const msg = String(error?.message ?? '')
  const key = Object.keys(ORDER_ADMIN_ERRORS).find((k) => msg.includes(k))
  if (key) return ORDER_ADMIN_ERRORS[key]
  if (/failed to fetch|networkerror|load failed|network request failed|timeout/i.test(msg)) return 'Нет соединения с сервером. Обновите список и проверьте статус заказа перед повтором.'
  return msg || 'Операция не выполнена.'
}
