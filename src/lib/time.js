// Время в базе хранится в UTC (timestamptz, ISO 8601). Пользователю показываем в его часовом поясе.
export const MUTE_DURATIONS = [
  ['10m', '10 минут'], ['1h', '1 час'], ['24h', '24 часа'], ['7d', '7 дней'], ['permanent', 'Навсегда'],
]
export const durationLabel = (key) => MUTE_DURATIONS.find(([k]) => k === key)?.[1] ?? key

const dateTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' })
const valid = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d }

export const formatDateTime = (iso) => { const d = iso && valid(iso); return d ? dateTime.format(d) : '—' }
export const formatDate = (iso) => { const d = iso && valid(iso); return d ? dateOnly.format(d) : '—' }

// Оставшееся время мута: null — бессрочно.
export function formatRemaining(seconds) {
  if (seconds == null) return 'бессрочно'
  const s = Math.max(0, Math.floor(seconds))
  if (s === 0) return 'истёк'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d} д ${h} ч`
  if (h > 0) return `${h} ч ${m} мин`
  if (m > 0) return `${m} мин ${s % 60} с`
  return `${s} с`
}

// Ответ/отзыв считается изменённым, если дата изменения заметно позже даты создания.
export function isEdited(createdIso, updatedIso, toleranceMs = 5000) {
  const a = valid(createdIso), b = valid(updatedIso)
  return Boolean(a && b && b.getTime() - a.getTime() > toleranceMs)
}
