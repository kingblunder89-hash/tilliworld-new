import { useState } from 'react'
import { Loading, ErrorBox, Empty } from './States.jsx'
import { Time, Pager } from './ReviewUi.jsx'
import { useAsync } from '../hooks/useAsync.js'
import { myTransactions, onEconomyRefresh } from '../services/economy.js'
import { TX_KINDS, formatCoins } from '../lib/economy.js'
import { useEffect } from 'react'

const PAGE = 10

// История операций игрока (только чтение). Записи нельзя изменить или удалить.
export default function Transactions() {
  const [page, setPage] = useState(1)
  const state = useAsync(() => myTransactions({ limit: PAGE, offset: (page - 1) * PAGE }), [page])
  useEffect(() => onEconomyRefresh(state.reload), [state.reload])
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0
  if (state.loading && !state.data) return <Loading />
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />
  if (state.data.length === 0) return <Empty title="Операций пока нет" text="Здесь появятся начисления за колесо удачи и другие изменения баланса." />
  return (
    <>
      <ul className="divide-y divide-white/[0.08] rounded-xl border border-white/[0.08] bg-ink-900/40">
        {state.data.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-white">{TX_KINDS[t.kind] ?? t.kind}{t.reason && t.reason !== TX_KINDS[t.kind] ? <span className="font-normal text-slate-400"> · {t.reason}</span> : null}</p>
              <p className="text-xs text-slate-500"><Time iso={t.created_at} /></p>
            </div>
            <div className="text-right">
              <p className={`font-bold ${t.amount > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{t.amount > 0 ? '+' : '−'}{formatCoins(Math.abs(t.amount))}</p>
              <p className="text-xs text-slate-500">баланс {formatCoins(t.balance_after)}</p>
            </div>
          </li>))}
      </ul>
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} />
    </>
  )
}
