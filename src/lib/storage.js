// Безопасная работа с localStorage: в приватном режиме или при заблокированных данных сайта доступ бросает исключение.
export function safeGet(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
export function safeSet(key, value) {
  try { localStorage.setItem(key, value) } catch { /* хранилище недоступно: работаем без него */ }
}
