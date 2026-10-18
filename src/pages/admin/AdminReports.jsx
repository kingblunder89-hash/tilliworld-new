import { useState } from 'react'
import { Loading, ErrorBox, Empty } from '../../components/States.jsx'
import { Time, Pager } from '../../components/ReviewUi.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { useToast } from '../../components/toastContext.js'
import { useAsync } from '../../hooks/useAsync.js'
import { refreshCounters } from '../../hooks/useCounters.js'
import { REPORT_REASONS, REVIEW_STATUSES } from '../../lib/reviewErrors.js'
import { adminListReports, adminResolveReport, adminModerateReview } from '../../services/reviews.js'

const PAGE = 20
const FILTERS = [['open', 'Открытые'], ['resolved', 'Обработанные'], ['dismissed', 'Отклонённые'], ['all', 'Все']]
const STATUS_LABEL = { open: 'Открыта', resolved: 'Обработана', dismissed: 'Отклонена' }

export default function AdminReports() {
  const toast = useToast()
  const [status, setStatus] = useState('open')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null) // { kind: 'dismissed' | 'resolved' | 'hide', report }
  const [note, setNote] = useState('')
  const state = useAsync(() => adminListReports({ status, limit: PAGE, offset: (page - 1) * PAGE }), [status, page])
  const done = () => { state.reload(); refreshCounters() }
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0
  const close = () => { setDialog(null); setNote('') }

  const TEXT = {
    dismissed: ['Отклонить жалобу?', 'Нарушения нет. Отзыв остаётся на сайте.', 'Отклонить'],
    resolved: ['Закрыть жалобу?', 'Жалоба будет отмечена как обработанная. Отзыв не изменится.', 'Закрыть'],
    hide: ['Скрыть отзыв и закрыть жалобу?', 'Отзыв и ответ к нему пропадут с сайта, жалоба будет отмечена как обработанная.', 'Скрыть и закрыть'],
  }
  const confirm = async () => {
    const { kind, report } = dialog
    if (kind === 'hide') await adminModerateReview(report.review_id, 'hidden')
    await adminResolveReport(report.id, kind === 'dismissed' ? 'dismissed' : 'resolved', note)
    toast.success('Жалоба обработана'); done()
  }

  return (
    <div>
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">Жалобы</h1>
      <div className="mb-4 flex flex-wrap gap-1" role="group" aria-label="Фильтр жалоб">
        {FILTERS.map(([k, v]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1) }}
            className={`rounded-block px-3 py-2 text-sm font-medium ${status === k ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>{v}</button>))}
      </div>
      {state.loading ? <Loading /> : state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : state.data.length === 0 ? <Empty title="Жалоб нет" /> : (
        <ul className="space-y-3">
          {state.data.map((r) => (
            <li key={r.id} className="card space-y-2 p-4">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="rounded-block bg-red-400/15 px-2 py-0.5 font-bold text-red-300">{REPORT_REASONS[r.reason] ?? r.reason}</span>
                <span className="text-slate-300">от {r.reporter_nickname ?? 'игрока без ника'}</span>
                <span className="text-slate-400"><Time iso={r.created_at} /></span>
                <span className="rounded-block bg-white/10 px-2 py-0.5 text-xs font-bold text-slate-200">{STATUS_LABEL[r.status]}</span>
              </p>
              {r.details && <p className="break-words text-sm text-slate-300">Пояснение: {r.details}</p>}
              <div className="rounded-block bg-ink-900 p-3 text-sm">
                <p className="text-slate-400">Отзыв {r.review_author} · {REVIEW_STATUSES[r.review_status]}</p>
                <p className="mt-1 whitespace-pre-line break-words text-slate-200">{r.review_body}</p>
              </div>
              {r.status === 'open' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setDialog({ kind: 'dismissed', report: r })}>Отклонить жалобу</button>
                  <button type="button" className="btn-ghost" onClick={() => setDialog({ kind: 'resolved', report: r })}>Закрыть как обработанную</button>
                  {r.review_status !== 'hidden' && <button type="button" className="btn-danger" onClick={() => setDialog({ kind: 'hide', report: r })}>Скрыть отзыв и закрыть</button>}
                </div>
              ) : <p className="text-xs text-slate-500">Обработана <Time iso={r.resolved_at} />{r.resolution_note ? ` · ${r.resolution_note}` : ''}</p>}
            </li>))}
        </ul>)}
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} />
      {dialog && (
        <ConfirmDialog title={TEXT[dialog.kind][0]} text={TEXT[dialog.kind][1]} confirmLabel={TEXT[dialog.kind][2]} danger={dialog.kind === 'hide'} onClose={close} onConfirm={confirm}>
          <div><label className="label" htmlFor="res-note">Комментарий (необязательно)</label>
            <textarea id="res-note" className="input min-h-16 py-2" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </ConfirmDialog>)}
    </div>
  )
}
