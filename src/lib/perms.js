// Только для интерфейса (какие вкладки показать). Реальную проверку делает база по JWT.
// Нет ключа permissions — полный доступ (как у ранее созданных администраторов).
export function adminHas(user, perm) {
  const meta = user?.app_metadata
  if (meta?.role !== 'admin') return false
  const list = meta.permissions
  if (!Array.isArray(list)) return true
  return list.includes('all') || list.includes(perm)
}
export const adminFull = (user) => adminHas(user, 'all')
