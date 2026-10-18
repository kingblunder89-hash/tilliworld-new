import { Link } from 'react-router-dom'
import { Loading, ErrorBox, Empty } from '../../components/States.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { adminStats, listOrders } from '../../services/shop.js'
import { StatusBadge } from './Orders.jsx'
import { useCounters } from '../../hooks/useCounters.js'
import ServerStatusControl from '../../components/ServerStatusControl.jsx'

export default function Dashboard() {
  const counters = useCounters()
  const s = useAsync(adminStats)
  const o = useAsync(() => listOrders(5))
  if (s.loading || o.loading) return <Loading />
  if (s.error || o.error) return <ErrorBox message={s.error || o.error} onRetry={() => { s.reload(); o.reload() }} />
  const stats = [['Новые заявки', s.data.newOrders], ['Всего заявок', s.data.totalOrders], ['Активные предметы', s.data.activeProducts]]
  return (
    <div className="space-y-8">
      <ServerStatusControl />
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map(([l, v]) => <div key={l} className="card p-5"><p className="font-display text-3xl font-semibold tabular-nums text-accent-200">{v}</p><p className="text-sm text-slate-400">{l}</p></div>)}
      </div>
      {counters && (
        <div className="grid gap-4 sm:grid-cols-3" aria-label="Модерация">
          {[['Новые отзывы', counters.pending_reviews, '/admin/reviews'], ['Открытые жалобы', counters.open_reports, '/admin/reports'], ['Активные муты', counters.active_mutes, '/admin/mutes']].map(([l, v, to]) => (
            <Link key={l} to={to} className="card p-5 transition-colors hover:border-accent-400/30 hover:bg-ink-700"><p className={`font-display text-3xl font-semibold tabular-nums ${v > 0 && l !== 'Активные муты' ? 'text-red-300' : 'text-accent-200'}`}>{v}</p><p className="text-sm text-slate-400">{l}</p></Link>))}
        </div>)}
      <div className="flex flex-wrap gap-3">
        <Link to="/admin/orders" className="btn-primary">Управление заявками</Link>
        <Link to="/admin/products" className="btn-ghost">Управление каталогом</Link>
        <Link to="/admin/reviews" className="btn-ghost">Отзывы</Link>
      </div>
      <section>
        <h2 className="mb-3 text-lg font-bold text-white">Последние заявки</h2>
        {o.data.length === 0 ? <Empty title="Заявок пока нет" /> : (
          <ul className="card divide-y divide-white/10">
            {o.data.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 p-4 text-sm">
                <span className="text-white">#{r.order_number} · {r.minecraft_nickname} · {r.product_name_snapshot} × {r.quantity}</span>
                <StatusBadge status={r.status} />
              </li>))}
          </ul>)}
      </section>
    </div>
  )
}
