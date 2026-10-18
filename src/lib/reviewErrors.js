import { formatDateTime } from './time.js'

// Коды ошибок SQL-функций из supabase/migrations/004_reviews_mutes_audit.sql
export const REVIEW_ERRORS = {
  not_authenticated: 'Войдите в аккаунт, чтобы продолжить.',
  forbidden: 'Недостаточно прав для этого действия.',
  profile_required: 'Сначала укажите игровой ник в профиле.',
  invalid_nickname: 'Ник: 3–16 символов, латиница, цифры и _.',
  password_too_short: 'Пароль: минимум 8 символов.',
  password_too_long: 'Пароль слишком длинный (максимум 72 символа).',
  invalid_rating: 'Поставьте оценку от 1 до 5.',
  body_too_short: 'Отзыв слишком короткий: минимум 10 символов.',
  body_too_long: 'Отзыв слишком длинный: максимум 1000 символов.',
  links_not_allowed: 'Ссылки в отзывах запрещены.',
  invalid_characters: 'Текст содержит недопустимые символы.',
  review_exists: 'Вы уже оставили отзыв. Его можно изменить или удалить.',
  review_not_found: 'Отзыв не найден.',
  review_hidden: 'Отзыв скрыт модератором, изменить его нельзя.',
  review_not_published: 'Ответить можно только на опубликованный отзыв.',
  rate_limited: 'Слишком часто. Подождите немного и повторите.',
  invalid_reason: 'Выберите причину жалобы.',
  details_too_long: 'Пояснение слишком длинное (максимум 300 символов).',
  already_reported: 'Вы уже отправляли жалобу на этот отзыв.',
  cannot_report_own: 'Нельзя пожаловаться на собственный отзыв.',
  reply_empty: 'Введите текст ответа.',
  reply_too_long: 'Ответ слишком длинный (максимум 1000 символов).',
  reply_not_found: 'Ответ не найден.',
  not_reply_author: 'Этот ответ написал другой администратор.',
  invalid_name: 'Публичное имя: 2–32 символа без символов < и >.',
  invalid_status: 'Недопустимый статус.',
  report_not_open: 'Жалоба уже обработана.',
  note_too_long: 'Комментарий слишком длинный (максимум 300 символов).',
  reason_required: 'Укажите причину (минимум 3 символа).',
  reason_too_long: 'Причина слишком длинная.',
  invalid_duration: 'Выберите срок мута из списка.',
  user_not_found: 'Пользователь не найден.',
  cannot_mute_self: 'Нельзя выдать мут самому себе.',
  cannot_mute_admin: 'Нельзя выдать мут администратору.',
  already_muted: 'У игрока уже есть активный мут. Сначала снимите его.',
  mute_not_found: 'Мут не найден.',
  mute_not_active: 'Мут уже неактивен (истёк или снят).',
  cannot_lift_own_mute: 'Нельзя снять собственный мут.',
  player_not_found: 'Аккаунт игрока не найден (возможно, уже удалён).',
  not_linked: 'У этого игрока нет привязанного Minecraft-аккаунта.',
  nickname_mismatch: 'Ник введён неверно. Аккаунт не удалён.',
  query_too_short: 'Введите минимум 2 символа для поиска.',
  too_many_pending: 'Сейчас слишком много заявок на регистрацию. Попробуйте позже.',
  already_approved: 'Аккаунт уже подтверждён.',
  already_rejected: 'Заявка уже отклонена.',
  wheel_cooldown: 'Бесплатный спин уже использован. Следующий будет доступен позже.',
  wheel_disabled: 'Колесо удачи сейчас отключено.',
  prizes_invalid: 'Призы заданы неверно: от 2 до 12 призов, суммы — целые числа от 1 до 1 000 000 000.',
  chances_sum_invalid: 'Сумма вероятностей должна быть ровно 100%.',
  insufficient_funds: 'Недостаточно монет на балансе игрока.',
  invalid_amount: 'Сумма: целое число, не ноль и не больше 1 000 000 000 по модулю.',
  balance_overflow: 'Баланс не может превышать 1 000 000 000 000 монет.',
  audit_immutable: 'Записи журнала нельзя изменять или удалять.',
}

export function muteMessage(detail) {
  if (!detail || detail === 'permanent') return 'Вам запрещено публиковать отзывы на сайте (мут без срока). Причину можно посмотреть в аккаунте.'
  return `Вам запрещено публиковать отзывы до ${formatDateTime(detail)}.`
}

// error: объект ошибки supabase-js ({ message, details }). Технические подробности пользователю не показываем.
export function reviewErrorMessage(error) {
  const msg = String(error?.message ?? '')
  if (msg.includes('user_muted')) return muteMessage(error?.details)
  const key = Object.keys(REVIEW_ERRORS).find((k) => msg.includes(k))
  if (key) return REVIEW_ERRORS[key]
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Нет соединения с сервером. Проверьте интернет и повторите.'
  if (/permission denied/i.test(msg)) return 'Недостаточно прав для этого действия.'
  return 'Не удалось выполнить действие. Попробуйте позже.'
}

// Статусы, которые player_register / player_login возвращают вместо исключения (чтобы счётчик попыток сохранялся).
export const AUTH_STATUS = {
  nick_taken: 'Этот ник уже занят. Выберите другой или войдите.',
  invalid_credentials: 'Неверный ник или пароль.',
  too_many_attempts: 'Слишком много неудачных попыток входа. Подождите 15 минут.',
  pending_approval: 'Заявка на регистрацию отправлена. Администратор проверит её вручную, после этого вы сможете войти.',
  rejected: 'Регистрация отклонена администратором.',
}

export const LINK_STATUS_HELP = {
  ok: 'Аккаунт подтверждён.',
  invalid_code: 'Код неверный или уже использован.',
  expired_code: 'Срок действия кода истёк. Получите новый.',
  uuid_taken: 'Этот Minecraft-аккаунт уже привязан к другому аккаунту сайта.',
}

export const REPORT_REASONS = {
  spam: 'Спам или реклама', abuse: 'Оскорбления', offtopic: 'Не по теме', false_info: 'Ложная информация', other: 'Другое',
}
export const REVIEW_STATUSES = { pending: 'На модерации', approved: 'Опубликован', rejected: 'Отклонён', hidden: 'Скрыт' }
export const REVIEW_SORTS = {
  newest: 'Сначала новые', oldest: 'Сначала старые', highest: 'Высокая оценка', lowest: 'Низкая оценка',
}

export const ACCOUNT_ACTIONS = {
  password_reset: 'Сброс пароля', sessions_revoked: 'Завершение сессий', minecraft_unlinked: 'Отвязка Minecraft', account_deleted: 'Удаление аккаунта', account_approved: 'Регистрация одобрена', account_rejected: 'Регистрация отклонена',
}
