import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, Search, MessageSquareReply, Ban, Flag } from 'lucide-react'
import { Loading, ErrorBox, Empty } from '../../components/States.jsx'
import { Stars, VerifiedBadge, Time, Pager } from '../../components/ReviewUi.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import MuteDialog from '../../components/MuteDialog.jsx'
import { useToast } from '../../components/toastContext.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useAuth } from '../../hooks/useAuth.js'
import { refreshCounters } from '../../hooks/useCounters.js'
import { REVIEW_STATUSES } from '../../lib/reviewErrors.js'
import { adminFull, adminHas } from '../../lib/perms.js'
import { isEdited } from '../../lib/time.js'
import {
  adminListReviews, adminModerateReview, adminDeleteReview, adminReplyReview, adminDeleteReply, getAdminPublicName, setAdminPublicName,
} from '../../services/reviews.js'

const PAGE = 20
const BADGE = { pending: 'bg-amber-400/15 text-amber-300', approved: 'bg-emerald-400/15 text-emerald-300', rejected: 'bg-red-400/15 text-red-300', hidden: 'bg-slate-400/15 text-slate-300' }
const FILTERS = [['all', 'Все'], ...Object.entries(REVIEW_STATUSES)]

function PublicNameControl() {
  const toast = useToast()
  const state = useAsync(getAdminPublicName)
  const [name, setName] = useState(null)
  if (state.loading || state.error) return null
  const value = name ?? state.data ?? ''
  const save = async (e) => {
    e.preventDefault()
    try { await setAdminPublicName(value); toast.success('Публичное имя сохранено'); state.reload(); setName(null) } catch (ex) { toast.error(ex.message) }
  }
  return (
    <form onSubmit={save} className="card mb-4 flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-56 flex-1">
        <label className="label" htmlFor="pub-name">Имя в публичных ответах</label>
        <input id="pub-name" className="input" maxLength={32} value={value} onChange={(e) => setName(e.target.value)} placeholder="Администрация" />
        <p className="mt-1 text-xs text-slate-500">Показывается посетителям рядом с ответом. Почта не публикуется. Если пусто — «Администрация».</p>
      </div>
      <button className="btn-ghost" disabled={!value.trim() || value === (state.data ?? '')}>Сохранить</button>
    </form>
  )
}

function ReplyDialog({ review, onClose, onDone }) {
  const toast = useToast()
  const [body, setBody] = useState(review.reply_body ?? '')
  return (
    <ConfirmDialog title={review.reply_body ? 'Изменить ответ' : 'Ответить от имени администрации'} confirmLabel="Опубликовать ответ" onClose={onClose}
      onConfirm={async () => { await adminReplyReview(review.id, body); toast.success('Ответ опубликован'); onDone() }}>
      <p className="line-clamp-3 break-words rounded-block bg-ink-900 p-2 text-sm text-slate-400">{review.author_name}: {review.body}</p>
      <div><label className="label" htmlFor="reply-body">Ответ (виден всем посетителям)</label>
        <textarea id="reply-body" className="input min-h-28 py-2" maxLength={1000} required value={body} onChange={(e) => setBody(e.target.value)} /></div>
    </ConfirmDialog>
  )
}

export default function AdminReviews() {
  const { session } = useAuth()
  const user = session?.user
  const toast = useToast()
  const [status, setStatus] = useState('pending')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null) // { type, review }
  const state = useAsync(() => adminListReviews({ status, query, limit: PAGE, offset: (page - 1) * PAGE }), [status, query, page])

  const done = () => { state.reload(); refreshCounters() }
  const setReviewStatus = async (r, s, msg) => {
    try { await adminModerateReview(r.id, s); toast.success(msg); done() } catch (e) { toast.error(e.message) }
  }
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0

  return (
    <div>
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">Отзывы</h1>
      <PublicNameControl />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Фильтр по статусу">
          {FILTERS.map(([k, v]) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1) }}
              className={`rounded-block px-3 py-2 text-sm font-medium ${status === k ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>{v}</button>))}
        </div>
        <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()); setPage(1) }} role="search">
          <input className="input w-56" placeholder="Ник, текст или ID аккаунта" aria-label="Поиск отзывов" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn-ghost" aria-label="Искать"><Search className="size-4" aria-hidden="true" /></button>
        </form>
      </div>

      {state.loading ? <Loading /> : state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : state.data.length === 0 ? <Empty title="Отзывов нет" text="По выбранным фильтрам ничего не найдено." /> : (
        <ul className="space-y-3">
          {state.data.map((r) => {
            const ownReply = r.reply_admin_id === user?.id
            return (
              <li key={r.id} className="card space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-bold text-white">{r.author_name}</span>
                  {r.is_verified ? <VerifiedBadge /> : <span className="rounded-block bg-white/10 px-1.5 py-0.5 text-xs text-slate-400">не подтверждён</span>}
                  {!r.user_id && <span className="text-xs text-slate-500">старый отзыв (без аккаунта)</span>}
                  <Stars value={r.rating} />
                  <span className={`rounded-block px-2 py-0.5 text-xs font-bold ${BADGE[r.status]}`}>{REVIEW_STATUSES[r.status]}</span>
                  {r.is_muted && <span className="rounded-block bg-red-400/15 px-2 py-0.5 text-xs font-bold text-red-300">в муте</span>}
                  {r.open_reports > 0 && <Link to="/admin/reports" className="inline-flex items-center gap-1 rounded-block bg-red-400/15 px-2 py-0.5 text-xs font-bold text-red-300"><Flag className="size-3" aria-hidden="true" /> жалоб: {r.open_reports}</Link>}
                  <span className="text-sm text-slate-400"><Time iso={r.created_at} /></span>
                  {r.edited_at && <span className="text-xs text-slate-500">изменён <Time iso={r.edited_at} /></span>}
                </div>
                <p className="whitespace-pre-line break-words text-slate-200">{r.body}</p>
                {r.reply_body && (
                  <div className="rounded-block border border-accent-400/25 bg-accent-500/[0.06] p-3 text-sm">
                    <p className="text-slate-300"><b className="text-accent-300">Ответ администрации</b> · {r.reply_admin_name} · <Time iso={r.reply_created_at} />{isEdited(r.reply_created_at, r.reply_updated_at) && <> · изменён <Time iso={r.reply_updated_at} /></>}</p>
                    <p className="mt-1 whitespace-pre-line break-words text-slate-200">{r.reply_body}</p>
                    {!ownReply && <p className="mt-1 text-xs text-slate-500">Ответ другого администратора: изменить нельзя.</p>}
                  </div>)}
                <div className="flex flex-wrap gap-2">
                  {r.status !== 'approved' && <button type="button" className="btn-primary" onClick={() => setReviewStatus(r, 'approved', 'Отзыв опубликован')}>Опубликовать</button>}
                  {r.status === 'pending' && <button type="button" className="btn-ghost" onClick={() => setDialog({ type: 'reject', review: r })}>Отклонить</button>}
                  {r.status === 'approved' && <button type="button" className="btn-ghost" onClick={() => setDialog({ type: 'hide', review: r })}>Скрыть</button>}
                  {r.status === 'approved' && (!r.reply_body || ownReply) && <button type="button" className="btn-ghost" onClick={() => setDialog({ type: 'reply', review: r })}><MessageSquareReply className="size-4" aria-hidden="true" /> {r.reply_body ? 'Изменить ответ' : 'Ответить'}</button>}
                  {r.reply_body && (ownReply || adminFull(user)) && <button type="button" className="btn-ghost" onClick={() => setDialog({ type: 'delReply', review: r })}>Удалить ответ</button>}
                  {r.user_id && adminHas(user, 'mutes') && !r.is_muted && <button type="button" className="btn-ghost" onClick={() => setDialog({ type: 'mute', review: r })}><Ban className="size-4" aria-hidden="true" /> Мут автору</button>}
                  <button type="button" className="btn-danger" onClick={() => setDialog({ type: 'delete', review: r })} aria-label={`Удалить отзыв от ${r.author_name}`}><Trash2 className="size-4" aria-hidden="true" /></button>
                </div>
              </li>)
          })}
        </ul>)}
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} />

      {dialog?.type === 'reply' && <ReplyDialog review={dialog.review} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.type === 'mute' && <MuteDialog target={{ userId: dialog.review.user_id, nickname: dialog.review.author_name }} onClose={() => setDialog(null)} onDone={done} />}
      {['reject', 'hide'].includes(dialog?.type) && (
        <ConfirmDialog title={dialog.type === 'hide' ? 'Скрыть отзыв?' : 'Отклонить отзыв?'} danger confirmLabel={dialog.type === 'hide' ? 'Скрыть' : 'Отклонить'} onClose={() => setDialog(null)}
          text={dialog.type === 'hide' ? 'Отзыв и ответ к нему пропадут с сайта. Автор не сможет его изменить.' : 'Отзыв не будет опубликован. Автор сможет изменить текст и отправить его повторно.'}
          onConfirm={async () => { await adminModerateReview(dialog.review.id, dialog.type === 'hide' ? 'hidden' : 'rejected'); toast.success('Статус обновлён'); done() }} />)}
      {dialog?.type === 'delReply' && <ConfirmDialog title="Удалить ответ?" danger confirmLabel="Удалить" text="Ответ администрации исчезнет с сайта." onClose={() => setDialog(null)}
        onConfirm={async () => { await adminDeleteReply(dialog.review.id); toast.success('Ответ удалён'); done() }} />}
      {dialog?.type === 'delete' && <ConfirmDialog title="Удалить отзыв?" danger confirmLabel="Удалить навсегда" onClose={() => setDialog(null)}
        text={`Отзыв «${dialog.review.author_name}», ответ и жалобы на него будут удалены без возможности восстановления.`}
        onConfirm={async () => { await adminDeleteReview(dialog.review.id); toast.success('Отзыв удалён'); done() }} />}
    </div>
  )
}
