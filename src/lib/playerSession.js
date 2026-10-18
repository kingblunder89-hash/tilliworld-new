// Сессия игрока: случайный токен, который выдаёт база при входе. Хранится в localStorage и отправляется
// в заголовке x-player-token; база сама находит по нему игрока. Роль и id клиент не передаёт.
const KEY = 'tilli_player_token'
const listeners = new Set()

export function getPlayerToken() {
  try { const t = localStorage.getItem(KEY); return /^[0-9a-f]{64}$/.test(t || '') ? t : null } catch { return null }
}
export function setPlayerToken(token) {
  try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY) } catch { /* хранилище недоступно */ }
  listeners.forEach((f) => f())
}
export function subscribePlayerToken(fn) {
  listeners.add(fn)
  window.addEventListener('storage', fn) // вход/выход в другой вкладке
  return () => { listeners.delete(fn); window.removeEventListener('storage', fn) }
}
