import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { DEMO_PRODUCTS } from '../data/demo.js'
import { validateImage } from '../lib/images.js'
import { isUuid } from '../lib/ids.js'
import { orderErrorMessage } from '../lib/orderErrors.js'
import { ORDER_STATUSES } from '../config/server.js'
import { adminListReviews, adminDeleteReview, adminModerateReview } from './reviews.js'
import { purchaseError, validateSaleFields, orderAdminError } from '../lib/shop.js'
import { getPlayerToken, setPlayerToken } from '../lib/playerSession.js'

const IMAGE_BUCKET = 'product-images'

const need = () => {
  if (!isSupabaseConfigured) throw new Error('Supabase не настроен: заполните .env (см. README).')
  return supabase
}
const unwrap = ({ data, error }) => { if (error) throw new Error(error.message); return data }

/* ---------- публичные ---------- */
export async function listProducts() {
  if (!isSupabaseConfigured) return DEMO_PRODUCTS
  return unwrap(await supabase.from('products').select('*').eq('is_published', true).order('created_at', { ascending: false }))
}
// Предмет открывается по id (UUID) или по slug. Не-UUID нельзя отправлять в колонку uuid: Postgres вернёт ошибку приведения типа.
export async function getProduct(idOrSlug) {
  if (!isSupabaseConfigured) return DEMO_PRODUCTS.find((p) => p.id === idOrSlug || p.slug === idOrSlug) ?? null
  const column = isUuid(idOrSlug) ? 'id' : 'slug'
  return unwrap(await supabase.from('products').select('*').eq(column, idOrSlug).eq('is_published', true).maybeSingle())
}
export async function listReviews(limit) {
  if (!isSupabaseConfigured) return []
  // Публичное чтение идёт через представление public_reviews: только одобренные отзывы и только безопасные поля.
  let q = supabase.from('public_reviews').select('*').order('created_at', { ascending: false })
  if (limit) q = q.limit(limit)
  return unwrap(await q)
}

export async function createOrder({ productId, nickname, quantity, comment }) {
  const db = need()
  const { data, error } = await db.rpc('create_order', {
    p_product_id: productId, p_nickname: nickname, p_quantity: quantity, p_comment: comment || null,
  })
  if (error) throw new Error(orderErrorMessage(error))
  return data // order_number
}

/* ---------- покупка за монеты (миграция 010) ----------
   Клиент передаёт только товар, ключ попытки и цену, которую видел игрок. Списываемую сумму, баланс и правила повторной покупки
   определяет и проверяет база; цена из React ни на что не влияет, кроме проверки «цена не изменилась». */
async function shopRpc(name, args) {
  const { data, error } = await need().rpc(name, args)
  if (error) {
    const e = purchaseError(error)
    // токен просрочен или отозван: считаем игрока вышедшим, интерфейс покажет предложение войти
    if (e.code === 'not_authenticated' && getPlayerToken()) setPlayerToken(null)
    throw Object.assign(new Error(e.message), { code: e.code, detail: e.detail })
  }
  return data
}
// requestId — UUID одной попытки покупки: повтор с тем же ключом (двойной клик, повторная отправка после обрыва) не списывает монеты дважды.
export const purchaseProduct = ({ productId, requestId, expectedPrice }) =>
  shopRpc('shop_purchase', { p_product_id: productId, p_request_id: requestId, p_expected_price: expectedPrice ?? null })
export const myPurchases = () => shopRpc('shop_my_purchases')
export const myOrders = async ({ limit = 10, offset = 0 } = {}) => (await shopRpc('shop_my_orders', { p_limit: limit, p_offset: offset })) ?? []

/* Статус сервера выставляется администратором вручную. null = статус неизвестен (демо-режим, нет строки или ошибка чтения). */
export async function getServerStatus() {
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase.from('server_status').select('is_online, updated_at').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/* ---------- админские (права проверяет RLS в Supabase) ---------- */
export async function setServerStatus(isOnline) {
  if (typeof isOnline !== 'boolean') throw new Error('Недопустимое значение статуса.')
  const row = unwrap(await need().from('server_status').update({ is_online: isOnline }).eq('id', 1).select('is_online, updated_at').maybeSingle())
  if (!row) throw new Error('Не удалось изменить статус: нет прав или миграция 003 не применена.')
  return row
}
export async function listOrders(limit = 500) {
  return unwrap(await need().from('orders').select('*').order('created_at', { ascending: false }).limit(limit))
}
export async function updateOrderStatus(id, status) {
  if (!Object.hasOwn(ORDER_STATUSES, status)) throw new Error('Недопустимый статус заявки.')
  // RLS скрывает чужие/недоступные строки: если ни одна строка не обновилась, прав нет или заявки не существует
  const { data: row, error } = await need().from('orders').update({ status }).eq('id', id).select().maybeSingle()
  if (error) throw new Error(orderAdminError(error))
  if (!row) throw new Error('Не удалось изменить статус: нет права «shop» или заявка не найдена. Выйдите и войдите заново.')
  return row
}
// Шаги выдачи оплаченного заказа: 'start' (начать/повторить), 'fail' (ошибка, причина обязательна), 'done' (выдано).
// Переходы, блокировку и идемпотентность проверяет база (admin_fulfillment_step); повтор 'done' безопасен.
export async function fulfillmentStep(orderId, action, note = null) {
  const { data, error } = await need().rpc('admin_fulfillment_step', { p_order: orderId, p_action: action, p_note: note || null })
  if (error) throw new Error(orderAdminError(error))
  return data
}
export async function listAllProducts() {
  return unwrap(await need().from('products').select('*').order('created_at', { ascending: false }))
}
export async function saveProduct(p) {
  const img = p.image_url?.trim() || null
  if (img && !/^https:\/\//i.test(img)) throw new Error('Ссылка на изображение должна начинаться с https://')
  if (!p.name?.trim()) throw new Error('Укажите название предмета.')
  const sale = validateSaleFields(p)
  if (sale.error) throw new Error(sale.error)
  const row = {
    name: p.name.trim(), slug: p.slug.trim(), description: p.description.trim(), category: p.category.trim() || 'Разное',
    image_url: img, display_price: p.display_price?.trim() || null,
    is_published: !!p.is_published, is_available: !!p.is_available,
    ...sale.value, // цена в монетах и правила повторной покупки (проверяются ещё и ограничениями таблицы)
    product_type: p.product_type === 'privilege' ? 'privilege' : 'item',
    purchase_mode: p.product_type === 'privilege' && (p.duration_days === '' || p.duration_days == null) ? 'one_time' : sale.value.purchase_mode,
    max_per_player: p.product_type === 'privilege' && (p.duration_days === '' || p.duration_days == null) ? 1 : sale.value.max_per_player,
    repurchase_cooldown_hours: p.product_type === 'privilege' && (p.duration_days === '' || p.duration_days == null) ? null : sale.value.repurchase_cooldown_hours,
    grant_key: p.grant_key?.trim() || null, duration_days: p.duration_days === '' || p.duration_days == null ? null : Number(p.duration_days),
  }
  const q = p.id ? need().from('products').update(row).eq('id', p.id) : need().from('products').insert(row)
  return unwrap(await q.select().single())
}
export async function deleteProduct(id) {
  // Keep referenced products and historical snapshots intact; hide and disable instead of deleting.
  const { data, error } = await need().from('products').update({ is_published: false, is_available: false }).eq('id', id).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Не удалось скрыть товар: нет прав или товар не найден.')
  return data
}
/* Загрузка изображения предмета в Supabase Storage. Права на запись есть только у администратора (RLS на storage.objects). */
export async function uploadProductImage(file) {
  const db = need()
  const { type, ext } = await validateImage(file)
  const path = `${crypto.randomUUID()}.${ext}` // случайное имя: исходное имя файла не используется
  const { error } = await db.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: type, cacheControl: '31536000', upsert: false })
  if (error) throw new Error(`Не удалось загрузить изображение: ${error.message}`)
  return db.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}
// Удаляет файл из bucket, если ссылка указывает именно на него. Ошибки не критичны: файл просто останется.
export async function removeProductImage(url) {
  if (!isSupabaseConfigured || !url) return
  const marker = `/storage/v1/object/public/${IMAGE_BUCKET}/`
  const i = url.indexOf(marker)
  if (i === -1) return
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0])
  await supabase.storage.from(IMAGE_BUCKET).remove([path]).catch(() => {})
}
export async function adminStats() {
  const db = need()
  const count = async (q) => { const { count: c, error } = await q; if (error) throw new Error(error.message); return c ?? 0 }
  const [newOrders, totalOrders, activeProducts] = await Promise.all([
    count(db.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'new')),
    count(db.from('orders').select('*', { count: 'exact', head: true })),
    count(db.from('products').select('*', { count: 'exact', head: true }).eq('is_published', true)),
  ])
  return { newOrders, totalOrders, activeProducts }
}
// Модерация идёт через SQL-функции (прямая запись в reviews закрыта миграцией 004). Реализация — в services/reviews.js.
export async function listAllReviews() { return adminListReviews({ status: 'all', limit: 100 }) }
export async function deleteReview(id) { return adminDeleteReview(id) }
export async function setReviewStatus(id, status) { return adminModerateReview(id, status) }
