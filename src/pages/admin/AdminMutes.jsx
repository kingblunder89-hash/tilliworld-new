import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Loading, ErrorBox, Empty } from '../../components/States.jsx'
import { Time, Pager } from '../../components/ReviewUi.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { useToast } from '../../components/toastContext.js'
import { useAsync } from '../../hooks/useAsync.js'
import { refreshCounters } from '../../hooks/useCounters.js'
import { durationLabel, formatRemaining } from '../../lib/time.js'
import { adminListMutes, adminLiftMute } from '../../services/reviews.js'

const PAGE = 30
const FILTERS = [['all', 'Все'], ['active', 'Активные'], ['expired', 'Истёкшие'], ['lifted', 'Снятые']]
const BADGE = { active: 'bg-red-400/15 text-red-300', expired: 'bg-white/10 text-slate-300', lifted: 'bg-emerald-400/15 text-emerald-300' }
const LABEL = { active: 'Активен', expired: 'Истёк', lifted: 'Снят досрочно' }

// Оставшееся время: сервер отдаёт секунды на момент запроса, дальше считаем локально (часы клиента не используются как источник истины).
function Remaining({ seconds, fetchedAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (seconds == null) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [seconds])
  if (seconds == null) return <>бессрочно</>
  return <>{formatRemaining(Number(seconds) - (now - fetchedAt) / 1000)}</>
}

export default function AdminMutes() {
  const toast = useToast()
  const [status, setStatus] = useState('active')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [lifting, setLifting] = useState(null)
  const [reason, setReason] = useState('')
  const [fetchedAt, setFetchedAt] = useState(Date.now())
  const state = useAsync(async () => { const r = await adminListMutes({ status, query, limit: PAGE, offset: (page - 1) * PAGE }); setFetchedAt(Date.now()); return r }, [status, query, page])
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0
  const close = () => { setLifting(null); setReason('') }

  return (
    <div>
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">Муты на сайте</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Фильтр мутов">
          {FILTERS.map(([k, v]) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1) }}
              className={`rounded-block px-3 py-2 text-sm font-medium ${status === k ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>{v}</button>))}
        </div>
        <form className="ml-auto flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()); setPage(1) }}>
          <input className="input w-56" placeholder="Ник, причина, ID или UUID" aria-label="Поиск мутов" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn-ghost" aria-label="Искать"><Search className="size-4" aria-hidden="true" /></button>
        </form>
      </div>
      <p className="mb-4 text-sm text-slate-400">Чтобы выдать мут, найдите игрока на вкладке «Игроки» или нажмите «Мут автору» под отзывом. Мут действует только на сайте и не связан с наказаниями в Minecraft.</p>
      {state.loading ? <Loading /> : state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : state.data.length === 0 ? <Empty title="Мутов нет" /> : (
        <ul className="space-y-3">
          {state.data.map((m) => (
            <li key={m.id} className="card flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-base font-bold text-white">{m.target_nickname ?? 'без ника'}{m.target_mc_name && <span className="text-sm font-normal text-volt-300">MC: {m.target_mc_name}</span>}
                  <span className={`rounded-block px-2 py-0.5 text-xs font-bold ${BADGE[m.status]}`}>{LABEL[m.status]}</span></p>
                <p className="break-words text-slate-300">Причина: {m.reason}</p>
                <p className="text-slate-400">Выдал {m.issued_by_name} · <Time iso={m.created_at} /> · срок: {durationLabel(m.duration_key)}
                  {m.status === 'active' && <> · осталось: <b className="text-slate-200"><Remaining seconds={m.remaining_seconds} fetchedAt={fetchedAt} /></b></>}
                  {m.expires_at && m.status !== 'active' && m.status !== 'lifted' && <> · закончился <Time iso={m.expires_at} /></>}</p>
                {m.lifted_at && <p className="text-slate-400">Снял {m.lifted_by_name} · <Time iso={m.lifted_at} />{m.lift_reason ? ` · ${m.lift_reason}` : ''}</p>}
              </div>
              {m.status === 'active' && <button type="button" className="btn-ghost" onClick={() => setLifting(m)}>Снять досрочно</button>}
            </li>))}
        </ul>)}
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} />
      {lifting && (
        <ConfirmDialog title={`Снять мут: ${lifting.target_nickname ?? 'игрок'}`} text="Игрок снова сможет публиковать отзывы. Запись о муте и снятии останется в журнале." confirmLabel="Снять мут" danger onClose={close}
          onConfirm={async () => { await adminLiftMute(lifting.id, reason); toast.success('Мут снят'); state.reload(); refreshCounters() }}>
          <div><label className="label" htmlFor="lift-reason">Причина снятия (необязательно)</label>
            <textarea id="lift-reason" className="input min-h-16 py-2" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </ConfirmDialog>)}
    </div>
  )
}
