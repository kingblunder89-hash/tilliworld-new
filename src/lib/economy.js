// Чистые функции экономики (без побочных эффектов), покрыты тестами.
export const COIN_FORMAT = new Intl.NumberFormat('ru-RU')
export const formatCoins = (n) => COIN_FORMAT.format(Number(n) || 0)

// Вероятности хранятся в сотых долях процента (10000 = 100%).
export const bpToPercent = (bp) => (Number(bp) / 100).toFixed(2).replace(/\.?0+$/, '')
// '12,5' | '12.5' -> 1250; невалидное значение -> null
export function percentToBp(text) {
  const t = String(text ?? '').trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null
  const bp = Math.round(parseFloat(t) * 100)
  return bp >= 1 && bp <= 10000 ? bp : null
}
// '250' -> 250; только целые 1..1e9
export function parseAmount(text, { signed = false } = {}) {
  const t = String(text ?? '').trim()
  if (!(signed ? /^[+-]?\d{1,10}$/ : /^\d{1,10}$/).test(t)) return null
  const n = Number(t)
  return Math.abs(n) >= 1 && Math.abs(n) <= 1_000_000_000 ? n : null
}
// Проверка редактора призов: { prizes: [{amount, chance_bp}] | null, totalBp, error }
export function validatePrizeRows(rowsInput) {
  const prizes = []
  let totalBp = 0
  for (const r of rowsInput) {
    const amount = parseAmount(r.amount)
    const bp = percentToBp(r.percent)
    if (amount == null) return { prizes: null, totalBp, error: 'Сумма приза: целое число от 1 до 1 000 000 000.' }
    if (bp == null) return { prizes: null, totalBp, error: 'Вероятность: от 0,01 до 100 (не больше двух знаков после запятой).' }
    prizes.push({ amount, chance_bp: bp }); totalBp += bp
  }
  if (prizes.length < 2 || prizes.length > 12) return { prizes: null, totalBp, error: 'Призов должно быть от 2 до 12.' }
  if (totalBp !== 10000) return { prizes: null, totalBp, error: `Сумма вероятностей ${bpToPercent(totalBp)}%, нужно ровно 100%.` }
  return { prizes, totalBp, error: null }
}
// Секунды до времени next (ISO) с поправкой на серверные часы: offsetMs = серверное_время − Date.now() на момент ответа.
export const secondsLeft = (nextIso, offsetMs, nowMs = Date.now()) => (nextIso ? Math.max(0, Math.ceil((Date.parse(nextIso) - (nowMs + offsetMs)) / 1000)) : 0)
export function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(sec))
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}
// Угол поворота колеса так, чтобы сектор prizeIndex оказался под указателем (сверху). Всегда крутит вперёд минимум на 5 оборотов.
export function targetRotation(currentDeg, prizeIndex, count, turns = 5) {
  const center = (prizeIndex + 0.5) * (360 / count)
  const base = Math.floor(currentDeg / 360) * 360
  return base + 360 * turns + ((360 - center) % 360)
}
export const TX_KINDS = { wheel_win: 'Колесо удачи', admin_credit: 'Начисление администратором', admin_debit: 'Списание администратором', purchase: 'Покупка', refund: 'Возврат' }
