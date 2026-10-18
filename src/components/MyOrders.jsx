import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading, ErrorBox, Empty } from './States.jsx'
import { Time, Pager } from './ReviewUi.jsx'
import { useAsync } from '../hooks/useAsync.js'
import { myOrders } from '../services/shop.js'
import { onEconomyRefresh } from '../services/economy.js'
import { formatCoins } from '../lib/economy.js'
import { orderStatusForPlayer } from '../lib/shop.js'

const PAGE = 10
const TONE = { sky: 'bg-volt-500/15 text-volt-300', amber: 'bg-amber-400/15 text-amber-300', green: 'bg-emerald-400/15 text-emerald-300', red: 'bg-red-400/15 text-red-300' }

// Покупки игрока и их статус. «Выдан» показывается только после отметки администратора; до этого — «ожидает выдачи».
export default function MyOrders() {
  const [page, setPage] = useState(1)
  const state = useAsync(() => myOrders({ limit: PAGE, offset: (page - 1) * PAGE }), [page])
  useEffect(() => onEconomyRefresh(state.reload), [state.reload])
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0
  if (state.loading && !state.data) return <Loading />
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />
  if (state.data.length === 0) return <Empty title="Покупок пока нет" text={<>Предметы с ценой можно купить в <Link to="/shop" className="text-accent-300 underline">каталоге</Link>.</>} />
  return (
    <>
      <ul className="divide-y divide-white/[0.08] rounded-xl border border-white/[0.08] bg-ink-900/40">
        {state.data.map((o) => {
          const st = orderStatusForPlayer(o.status, o.refunded)
          return (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-white">#{o.order_number} · {o.product_name}</p>
                <p className="text-xs text-slate-500"><Time iso={o.created_at} /> · ник для выдачи: {o.minecraft_nickname}{o.nickname_verified ? '' : ' (не подтверждён)'}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-amber-200">{formatCoins(o.price)} монет</p>
                <p className={`mt-1 inline-block rounded-block px-2 py-0.5 text-xs font-bold ${TONE[st.tone]}`}>{st.label}</p>
              </div>
            </li>)
        })}
      </ul>
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} />
    </>
  )
}
