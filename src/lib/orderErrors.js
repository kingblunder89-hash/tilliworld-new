// Сообщения для пользователя по кодам ошибок функции create_order (см. supabase/migrations/001_init.sql).
export const ORDER_ERRORS = {
  invalid_nickname: 'Ник: 3–16 символов, латиница, цифры и _.',
  invalid_quantity: 'Количество должно быть целым числом от 1 до 999.',
  comment_too_long: 'Комментарий слишком длинный (максимум 500 символов).',
  product_unavailable: 'Этот предмет сейчас недоступен для заявок.',
  priced_product: 'Этот предмет продаётся за монеты сайта: нажмите «Купить» на странице предмета.',
  rate_limited: 'Слишком много заявок. Подождите минуту и повторите.',
}

export function orderErrorMessage(error) {
  const msg = String(error?.message ?? '')
  const key = Object.keys(ORDER_ERRORS).find((k) => msg.includes(k))
  if (key) return ORDER_ERRORS[key]
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Нет соединения с сервером. Проверьте интернет и повторите.'
  return 'Не удалось сохранить заявку. Попробуйте позже.'
}
