import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { reviewErrorMessage, AUTH_STATUS } from '../lib/reviewErrors.js'
import { getPlayerToken, setPlayerToken } from '../lib/playerSession.js'

// Все действия идут через SQL-функции: роль, автор и время определяются на сервере (JWT), а не клиентом.
const need = () => {
  if (!isSupabaseConfigured) throw new Error('Supabase не настроен: заполните .env (см. README).')
  return supabase
}
export async function rpc(name, args) {
  const { data, error } = await need().rpc(name, args)
  if (error) {
    // токен просрочен или отозван: считаем игрока вышедшим, интерфейс покажет форму входа
    if (String(error.message).includes('not_authenticated') && getPlayerToken()) setPlayerToken(null)
    throw new Error(reviewErrorMessage(error))
  }
  return data
}
export const rows = async (name, args) => (await rpc(name, args)) ?? []

/* ---------- публичное чтение ---------- */
export const PAGE_SIZE = 10
const ORDERS = {
  newest: [['created_at', false]],
  oldest: [['created_at', true]],
  highest: [['rating', false], ['created_at', false]],
  lowest: [['rating', true], ['created_at', false]],
}
export async function listReviewsPage({ sort = 'newest', page = 1, pageSize = PAGE_SIZE } = {}) {
  if (!isSupabaseConfigured) return { items: [], total: 0 }
  const order = ORDERS[sort] ?? ORDERS.newest
  let q = supabase.from('public_reviews').select('*', { count: 'exact' })
  for (const [col, asc] of order) q = q.order(col, { ascending: asc })
  q = q.order('id').range((page - 1) * pageSize, page * pageSize - 1)
  const { data, error, count } = await q
  if (error) throw new Error(reviewErrorMessage(error))
  return { items: data ?? [], total: count ?? 0 }
}
export async function getReviewStats() {
  const empty = { total: 0, average: 0, s1: 0, s2: 0, s3: 0, s4: 0, s5: 0 }
  if (!isSupabaseConfigured) return empty
  const { data, error } = await supabase.from('public_review_stats').select('*').single()
  if (error) throw new Error(reviewErrorMessage(error))
  return { ...empty, ...data, average: Number(data.average) }
}

/* ---------- аккаунт игрока: ник + пароль, без почты ---------- */
async function authCall(name, nickname, password) {
  const r = await rpc(name, { p_nickname: nickname, p_password: password })
  if (r.status === 'pending_approval') return r // аккаунт ждёт ручного подтверждения админом, токена нет
  if (r.status === 'rejected') throw new Error(`${AUTH_STATUS.rejected}${r.reason ? ` Причина: ${r.reason}` : ''}`)
  if (r.status !== 'ok') throw new Error(AUTH_STATUS[r.status] ?? 'Не удалось выполнить вход. Попробуйте позже.')
  setPlayerToken(r.token)
  return r
}
export const playerRegister = (nickname, password) => authCall('player_register', nickname, password)
export const playerLogin = (nickname, password) => authCall('player_login', nickname, password)
export async function playerLogout() {
  try { await rpc('player_logout') } catch { /* токен всё равно удаляем локально */ }
  setPlayerToken(null)
}

/* ---------- игрок ---------- */
export const myAccount = () => rpc('my_account')
export const createLinkCode = () => rpc('create_link_code')
export const unlinkMinecraft = () => rpc('unlink_minecraft')
export const myReview = () => rpc('my_review')
export const submitReview = ({ rating, body }) => rpc('submit_review', { p_rating: rating, p_body: body })
export const editMyReview = ({ rating, body }) => rpc('edit_my_review', { p_rating: rating, p_body: body })
export const deleteMyReview = () => rpc('delete_my_review')
export const submitReport = ({ reviewId, reason, details }) =>
  rpc('submit_report', { p_review_id: reviewId, p_reason: reason, p_details: details || null })

/* ---------- администратор ---------- */
export const adminCounters = () => rpc('admin_counters')
export const getAdminPublicName = () => rpc('get_admin_public_name')
export const setAdminPublicName = (name) => rpc('set_admin_public_name', { p_name: name })
export const adminListReviews = ({ status = 'all', query = '', limit = 20, offset = 0 } = {}) =>
  rows('admin_list_reviews', { p_status: status, p_query: query || null, p_limit: limit, p_offset: offset })
export const adminModerateReview = (id, status) => rpc('admin_moderate_review', { p_review_id: id, p_status: status })
export const adminDeleteReview = (id) => rpc('admin_delete_review', { p_review_id: id })
export const adminReplyReview = (id, body) => rpc('admin_reply_review', { p_review_id: id, p_body: body })
export const adminDeleteReply = (id) => rpc('admin_delete_reply', { p_review_id: id })
export const adminListReports = ({ status = 'open', limit = 30, offset = 0 } = {}) =>
  rows('admin_list_reports', { p_status: status, p_limit: limit, p_offset: offset })
export const adminResolveReport = (id, status, note) => rpc('admin_resolve_report', { p_report_id: id, p_status: status, p_note: note || null })
export const adminSearchPlayers = (query) => rows('admin_search_players', { p_query: query })
export const adminIssueMute = ({ userId, duration, reason }) =>
  rpc('admin_issue_mute', { p_user_id: userId, p_duration: duration, p_reason: reason })
export const adminLiftMute = (id, reason) => rpc('admin_lift_mute', { p_mute_id: id, p_reason: reason || null })
export const adminListMutes = ({ status = 'all', query = '', limit = 50, offset = 0 } = {}) =>
  rows('admin_list_mutes', { p_status: status, p_query: query || null, p_limit: limit, p_offset: offset })
export const adminAuditLog = ({ event = 'all', query = '', limit = 50, offset = 0 } = {}) =>
  rows('admin_audit_log', { p_event: event, p_query: query || null, p_limit: limit, p_offset: offset })
export const adminListAccounts = ({ filter = 'all', query = '', limit = 20, offset = 0 } = {}) =>
  rows('admin_list_accounts', { p_filter: filter, p_query: query || null, p_limit: limit, p_offset: offset })
export const adminApprovePlayer = (id) => rpc('admin_approve_player', { p_id: id })
export const adminRejectPlayer = (id, reason) => rpc('admin_reject_player', { p_id: id, p_reason: reason })
export const adminAccountDetail = (id) => rpc('admin_account_detail', { p_id: id })
export const adminResetPassword = (id, password) => rpc('admin_reset_player_password', { p_id: id, p_password: password })
export const adminRevokeSessions = (id) => rpc('admin_revoke_player_sessions', { p_id: id })
export const adminUnlinkMinecraft = (id) => rpc('admin_unlink_player_minecraft', { p_id: id })
export const adminDeletePlayer = ({ id, nickname, deleteReviews }) =>
  rpc('admin_delete_player', { p_id: id, p_nickname: nickname, p_delete_reviews: deleteReviews })
export const adminAccountActions = ({ query = '', limit = 50, offset = 0 } = {}) =>
  rows('admin_account_actions', { p_query: query || null, p_limit: limit, p_offset: offset })
