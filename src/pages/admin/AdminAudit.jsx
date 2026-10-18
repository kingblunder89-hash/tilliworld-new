import { useState } from 'react'
import { Search, Lock } from 'lucide-react'
import { Loading, ErrorBox, Empty } from '../../components/States.jsx'
import { Time, Pager } from '../../components/ReviewUi.jsx'
import { useAsync } from '../../hooks/useAsync.js'
import { durationLabel } from '../../lib/time.js'
import { adminAuditLog } from '../../services/reviews.js'

const PAGE = 30
const FILTERS = [['all', 'Все события'], ['issued', 'Выдача'], ['expired', 'Истечение срока'], ['lifted', 'Снятие']]
const EVENT = {
  issued: ['Выдача', 'bg-red-400/15 text-red-300'],
  expired: ['Истечение срока', 'bg-white/10 text-slate-300'],
  lifted: ['Ручное снятие', 'bg-emerald-400/15 text-emerald-300'],
}

export default function AdminAudit() {
  const [event, setEvent] = useState('all')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const state = useAsync(() => adminAuditLog({ event, query, limit: PAGE, offset: (page - 1) * PAGE }), [event, query, page])
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0

  return (
    <div>
      <h1 className="mb-2 font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">История наказаний</h1>
      <p className="mb-4 flex items-center gap-2 text-sm text-slate-400"><Lock className="size-4 shrink-0" aria-hidden="true" /> Журнал только для чтения: записи нельзя изменить или удалить. Время показано в вашем часовом поясе, точное значение в UTC — во всплывающей подсказке.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Тип события">
          {FILTERS.map(([k, v]) => (
            <button key={k} type="button" aria-pressed={event === k} onClick={() => { setEvent(k); setPage(1) }}
              className={`rounded-block px-3 py-2 text-sm font-medium ${event === k ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>{v}</button>))}
        </div>
        <form className="ml-auto flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()); setPage(1) }}>
          <input className="input w-56" placeholder="Ник, админ, причина, ID" aria-label="Поиск по журналу" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn-ghost" aria-label="Искать"><Search className="size-4" aria-hidden="true" /></button>
        </form>
      </div>
      {state.loading ? <Loading /> : state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : state.data.length === 0 ? <Empty title="Записей нет" /> : (
        <ul className="space-y-3">
          {state.data.map((a) => (
            <li key={a.id} className="card space-y-1 p-4 text-sm">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`rounded-block px-2 py-0.5 text-xs font-bold ${EVENT[a.event_type][1]}`}>{EVENT[a.event_type][0]}</span>
                <b className="text-base text-white">{a.target_nickname ?? 'без ника'}</b>
                <span className="text-slate-400"><Time iso={a.occurred_at} /></span>
              </p>
              <p className="text-slate-300">{a.event_type === 'issued' ? 'Выдал' : a.event_type === 'lifted' ? 'Снял' : 'Источник'}: {a.admin_name}</p>
              <p className="break-words text-slate-300">Причина наказания: {a.reason}</p>
              <p className="text-slate-400">Срок: {durationLabel(a.duration_key)}{a.issued_at && <> · выдан <Time iso={a.issued_at} /></>}{a.expires_at && <> · до <Time iso={a.expires_at} /></>}</p>
              {a.event_type === 'lifted' && <p className="text-slate-400">Причина снятия: {a.lift_reason || 'не указана'}</p>}
              <p className="break-all text-xs text-slate-500">Аккаунт: {a.user_id}{a.target_mc_uuid ? ` · Minecraft UUID: ${a.target_mc_uuid}` : ''}</p>
            </li>))}
        </ul>)}
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} />
    </div>
  )
}
