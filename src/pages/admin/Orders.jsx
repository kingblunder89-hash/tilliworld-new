import { useMemo, useState } from 'react'
import { Search, Eye } from 'lucide-react'
import { Loading, ErrorBox, Empty } from '../../components/States.jsx'
import Dialog from '../../components/Dialog.jsx'
import { useToast } from '../../components/toastContext.js'
import { useAsync } from '../../hooks/useAsync.js'
import { listOrders, updateOrderStatus, fulfillmentStep } from '../../services/shop.js'
import { ORDER_STATUSES } from '../../config/server.js'
import { formatCoins } from '../../lib/economy.js'

const BADGE = {
  new: 'bg-volt-500/15 text-volt-300',
  accepted: 'bg-amber-400/15 text-amber-300',
  completed: 'bg-emerald-400/15 text-emerald-300',
  rejected: 'bg-red-400/15 text-red-300',
}
const fmt = (iso) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

export const StatusBadge = ({ status }) => (
  <span className={`inline-block rounded-block px-2 py-0.5 text-xs font-bold ${BADGE[status] ?? 'bg-white/10 text-slate-300'}`}>{ORDER_STATUSES[status] ?? status}</span>
)

function StatusSelect({ order, onChange, busy }) {
  return (
    <select className="input w-auto" disabled={busy || Boolean(order.refunded_at)} title={order.refunded_at ? 'Монеты возвращены, статус изменить нельзя' : undefined} aria-label={`Статус заявки ${order.order_number}`} value={order.status} onChange={(e) => onChange(order, e.target.value)}>
      {Object.entries(ORDER_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  )
}

export default function Orders() {
  const { data, loading, error, reload } = useAsync(listOrders)
  const toast = useToast()
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [dir, setDir] = useState('desc')
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const rows = useMemo(() => (data ?? [])
    .filter((r) => (!st || r.status === st) && r.minecraft_nickname.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (dir === 'desc' ? -1 : 1) * a.created_at.localeCompare(b.created_at)), [data, q, st, dir])

  const current = data?.find((r) => r.id === openId) ?? null

  const change = async (r, status) => {
    if (status === r.status) return
    const refundNote = r.price_paid ? ` Игроку ${r.minecraft_nickname} будет автоматически возвращено ${formatCoins(r.price_paid)} монет.` : ''
    if (status === 'rejected' && !window.confirm(`Отклонить заявку #${r.order_number}?${refundNote}`)) return
    if (status === 'completed' && r.price_paid && !window.confirm(`Отметить заказ #${r.order_number} выполненным? Игрок увидит, что предмет выдан. Подтверждайте только после фактической выдачи в игре.`)) return
    setBusyId(r.id)
    try {
      await updateOrderStatus(r.id, status)
      toast.success(`Заявка #${r.order_number}: ${ORDER_STATUSES[status].toLowerCase()}`)
      reload()
    } catch (e) { toast.error(`Не удалось изменить статус: ${e.message}`) }
    finally { setBusyId(null) }
  }

  // Шаги выдачи оплаченного заказа. Сайт сам ничего не выдаёт в игре: «Выдано» нажимается только после фактической выдачи.
  const step = async (r, action) => {
    let note = null
    if (action === 'fail') {
      note = window.prompt(`Причина ошибки выдачи по заказу #${r.order_number} (не короче 3 символов):`)
      if (note === null) return
    }
    if (action === 'done' && !window.confirm(`Отметить заказ #${r.order_number} выданным? Игрок увидит подтверждение, а возврат монет станет невозможен. Подтверждайте только после фактической выдачи в игре.`)) return
    setBusyId(r.id)
    try {
      const res = await fulfillmentStep(r.id, action, note)
      toast.success(res?.duplicate ? `Заказ #${r.order_number} уже был выдан.` : `Заказ #${r.order_number}: ${{ start: 'выдача начата', fail: 'ошибка выдачи записана', done: 'выдан' }[action]}`)
      reload()
    } catch (e) { toast.error(e.message) }
    finally { setBusyId(null) }
  }

  return (
    <div>
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">Заявки</h1>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input className="input pl-10" placeholder="Поиск по Minecraft-нику" aria-label="Поиск по нику" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" aria-label="Фильтр по статусу" value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">Все статусы</option>
          {Object.entries(ORDER_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" aria-label="Сортировка по дате" value={dir} onChange={(e) => setDir(e.target.value)}>
          <option value="desc">Сначала новые</option><option value="asc">Сначала старые</option>
        </select>
      </div>

      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : rows.length === 0 ? (
        <Empty title={data.length ? 'Ничего не найдено' : 'Заявок пока нет'} text={data.length ? 'Измените поиск или фильтр.' : 'Новые заявки появятся здесь.'} />
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-500">Показано: {rows.length} из {data.length}{data.length >= 500 ? ' (загружены последние 500)' : ''}</p>

          {/* Таблица: от md и шире */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-white/[0.08] text-sm font-medium text-slate-400">
                <tr>
                  <th scope="col" className="p-3">№</th><th scope="col" className="p-3">Ник</th><th scope="col" className="p-3">Предмет</th>
                  <th scope="col" className="p-3">Кол-во</th><th scope="col" className="p-3">Комментарий</th><th scope="col" className="p-3">Создана</th>
                  <th scope="col" className="p-3">Статус</th><th scope="col" className="p-3"><span className="sr-only">Действия</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.03]">
                    <td className="p-3 font-bold text-white">#{r.order_number}</td>
                    <td className="p-3 text-white">{r.minecraft_nickname}</td>
                    <td className="p-3 text-slate-300">{r.product_name_snapshot}{r.price_paid ? <span className="block text-xs text-amber-200">оплачено {formatCoins(r.price_paid)} мон.{r.refunded_at ? ' · возвращено' : ''}</span> : null}</td>
                    <td className="p-3 text-slate-300">{r.quantity}</td>
                    <td className="max-w-[14rem] truncate p-3 text-slate-400" title={r.comment || ''}>{r.comment || '—'}</td>
                    <td className="whitespace-nowrap p-3 text-slate-400">{fmt(r.created_at)}</td>
                    <td className="p-3"><StatusSelect order={r} onChange={change} busy={busyId === r.id} /></td>
                    <td className="p-3">
                      <button type="button" className="btn-ghost min-h-9! px-3!" onClick={() => setOpenId(r.id)} aria-label={`Подробности заявки ${r.order_number}`}>
                        <Eye className="size-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Карточки: мобильные */}
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-white">#{r.order_number} · {r.minecraft_nickname}</p>
                    <p className="text-sm text-slate-300">{r.product_name_snapshot} × {r.quantity}{r.price_paid ? <span className="text-amber-200"> · оплачено {formatCoins(r.price_paid)} мон.{r.refunded_at ? ' (возвращено)' : ''}</span> : null}</p>
                    <p className="text-xs text-slate-500">{fmt(r.created_at)}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-3 flex gap-2">
                  <StatusSelect order={r} onChange={change} busy={busyId === r.id} />
                  <button type="button" className="btn-ghost" onClick={() => setOpenId(r.id)}><Eye className="size-4" aria-hidden="true" /> Подробнее</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {current && (
        <Dialog title={`Заявка #${current.order_number}`} onClose={() => setOpenId(null)} wide>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-400">Minecraft-ник</dt><dd className="font-bold text-white">{current.minecraft_nickname}</dd></div>
            <div><dt className="text-slate-400">Статус</dt><dd><StatusBadge status={current.status} /></dd></div>
            {current.price_paid ? <div><dt className="text-slate-400">Статус выдачи</dt><dd className="text-white">{{ pending: 'Ожидает выдачи', processing: 'Выдаётся', fulfilled: 'Выдано', failed: 'Ошибка выдачи', refunded: 'Возврат выполнен' }[current.fulfillment_status] ?? 'Ожидает выдачи'} · попыток: {current.fulfillment_attempts ?? 0}</dd></div> : null}
            <div><dt className="text-slate-400">Предмет (на момент заявки)</dt><dd className="text-white">{current.product_name_snapshot}</dd></div>
            <div><dt className="text-slate-400">Количество</dt><dd className="text-white">{current.quantity}</dd></div>
            <div><dt className="text-slate-400">Оплата</dt><dd className="text-white">{current.price_paid ? `${formatCoins(current.price_paid)} монет сайта${current.refunded_at ? ' (возвращены)' : ''}` : 'без оплаты (заявка)'}</dd></div>
            {current.price_paid ? <div><dt className="text-slate-400">Ник для выдачи</dt><dd className="text-white">{current.nickname_verified ? 'Подтверждён в игре (привязка Minecraft)' : 'НЕ подтверждён: это логин аккаунта на сайте'}</dd></div> : null}
            <div><dt className="text-slate-400">Создана</dt><dd className="text-white">{fmt(current.created_at)}</dd></div>
            <div><dt className="text-slate-400">Обновлена</dt><dd className="text-white">{fmt(current.updated_at)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-slate-400">Комментарий</dt><dd className="whitespace-pre-line break-words text-white">{current.comment || '—'}</dd></div>
          </dl>
          {current.price_paid && current.fulfillment_note ? <p className="mt-3 text-sm text-slate-300"><span className="text-slate-400">Примечание к выдаче: </span>{current.fulfillment_note}</p> : null}
          {current.price_paid && !current.refunded_at && current.status !== 'completed' && current.status !== 'rejected' ? (
            <div className="mt-6 border-t border-white/10 pt-4">
              <p className="label">Выдача предмета</p>
              <div className="flex flex-wrap gap-2">
                {current.fulfillment_status !== 'processing' && <button type="button" className="btn-ghost" disabled={busyId === current.id} onClick={() => step(current, 'start')}>{current.fulfillment_status === 'failed' ? 'Повторить выдачу' : 'Начать выдачу'}</button>}
                {current.fulfillment_status !== 'failed' && <button type="button" className="btn-ghost" disabled={busyId === current.id} onClick={() => step(current, 'fail')}>Ошибка выдачи</button>}
                <button type="button" className="btn-primary" disabled={busyId === current.id} onClick={() => step(current, 'done')}>Выдано</button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Если выдать не удаётся: отметьте «Ошибка выдачи», затем повторите выдачу или отклоните заказ — монеты вернутся игроку один раз. Во время выдачи («Выдаётся») заказ отклонить нельзя.</p>
            </div>
          ) : null}
          <div className="mt-6 border-t border-white/10 pt-4">
            <label className="label" htmlFor="dlg-status">Изменить статус</label>
            <select id="dlg-status" className="input" disabled={busyId === current.id || Boolean(current.refunded_at) || Boolean(current.price_paid && current.status === 'completed')} value={current.status} onChange={(e) => change(current, e.target.value)}>
              {Object.entries(ORDER_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <p className="mt-2 text-xs text-slate-500">Сайт не выдаёт предметы в игре автоматически: выдайте предмет вручную, затем отметьте заказ «Выполнена» — игрок увидит этот статус как подтверждение выдачи. «Отклонена» для оплаченного заказа автоматически возвращает монеты (один раз).</p>
          </div>
        </Dialog>
      )}
    </div>
  )
}
