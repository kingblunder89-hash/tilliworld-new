import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Flag, ShieldCheck, Ban } from 'lucide-react'
import { Loading, ErrorBox, Empty } from '../components/States.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { Stars, VerifiedBadge, Time, Pager } from '../components/ReviewUi.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import Dialog from '../components/Dialog.jsx'
import { useToast } from '../components/toastContext.js'
import { useAsync } from '../hooks/useAsync.js'
import { usePlayer } from '../hooks/usePlayer.js'
import { isSupabaseConfigured } from '../lib/supabase.js'
import { REPORT_REASONS, REVIEW_SORTS, REVIEW_STATUSES } from '../lib/reviewErrors.js'
import { formatDateTime, isEdited } from '../lib/time.js'
import {
  PAGE_SIZE, listReviewsPage, getReviewStats, myAccount, myReview, submitReview, editMyReview, deleteMyReview, submitReport,
} from '../services/reviews.js'

function ReviewCard({ r, onReport }) {
  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={r.rating} />
        <span className="font-bold text-white">{r.author_name}</span>
        {r.is_verified && <VerifiedBadge />}
        <span className="text-sm text-slate-400"><Time iso={r.created_at} /></span>
        {r.edited_at && <span className="text-xs text-slate-500">изменён <Time iso={r.edited_at} /></span>}
      </div>
      <p className="mt-3 whitespace-pre-line break-words text-slate-200">{r.body}</p>
      {r.reply_body && (
        <div className="mt-4 rounded-block border border-accent-400/25 bg-accent-500/[0.06] p-3">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="inline-flex items-center gap-1 font-bold text-accent-300"><ShieldCheck className="size-4" aria-hidden="true" /> Ответ администрации</span>
            <span className="text-slate-300">{r.reply_admin_name}</span>
            <span className="text-slate-400"><Time iso={r.reply_created_at} /></span>
            {isEdited(r.reply_created_at, r.reply_updated_at) && <span className="text-xs text-slate-500">изменён <Time iso={r.reply_updated_at} /></span>}
          </p>
          <p className="mt-2 whitespace-pre-line break-words text-slate-200">{r.reply_body}</p>
          {r.edited_at && new Date(r.edited_at) > new Date(r.reply_created_at) && (
            <p className="mt-2 text-xs text-amber-300">Отзыв изменён после этого ответа.</p>
          )}
        </div>
      )}
      {onReport && <button type="button" className="mt-3 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-red-300" onClick={() => onReport(r)}><Flag className="size-3.5" aria-hidden="true" /> Пожаловаться</button>}
    </article>
  )
}

// Компактный список для главной страницы.
export function ReviewList({ state }) {
  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />
  if (!state.data.length) return <Empty title="Отзывов пока нет" text="Здесь появятся проверенные модератором отзывы игроков." />
  return <div className="grid gap-5 md:grid-cols-3">{state.data.map((r) => <ReviewCard key={r.id} r={r} />)}</div>
}

function Summary({ stats }) {
  if (!stats.total) return null
  return (
    <div className="card mb-6 grid gap-6 p-5 sm:grid-cols-[auto_1fr]" aria-label="Сводка по отзывам">
      <div className="text-center sm:text-left">
        <p className="font-display text-5xl font-semibold text-white">{stats.average.toFixed(1)}</p>
        <Stars value={stats.average} size="size-5" />
        <p className="mt-1 text-sm text-slate-400">{stats.total} {pluralReviews(stats.total)}</p>
      </div>
      <ul className="space-y-1.5" aria-label="Распределение оценок">
        {[5, 4, 3, 2, 1].map((n) => (
          <li key={n} className="flex items-center gap-3 text-sm text-slate-300">
            <span className="w-4 text-right">{n}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-accent-400" style={{ width: `${(stats[`s${n}`] / stats.total) * 100}%` }} /></span>
            <span className="w-8 text-slate-400">{stats[`s${n}`]}</span>
          </li>))}
      </ul>
    </div>
  )
}
function pluralReviews(n) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'отзыв'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'отзыва'
  return 'отзывов'
}

function StarInput({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Оценка" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} из 5`} onClick={() => onChange(n)}
          className="grid size-11 place-items-center rounded-block transition-colors hover:bg-white/[0.06]">
          <svg viewBox="0 0 24 24" className={`size-7 ${n <= value ? 'fill-accent-400 text-accent-400' : 'fill-none text-slate-500'}`} stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
        </button>))}
    </div>
  )
}

function ReviewForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [rating, setRating] = useState(initial?.rating ?? 0)
  const [body, setBody] = useState(initial?.body ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const len = body.trim().length
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!rating) return setErr('Поставьте оценку от 1 до 5.')
    if (len < 10) return setErr('Отзыв слишком короткий: минимум 10 символов.')
    setBusy(true); setErr('')
    try { await onSubmit({ rating, body: body.trim() }) } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <StarInput value={rating} onChange={setRating} />
      <div>
        <label className="label" htmlFor="review-body">Ваш отзыв</label>
        <textarea id="review-body" className="input min-h-28 py-2" maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Расскажите о своём опыте игры на сервере" />
        <p className={`mt-1 text-xs ${len > 0 && len < 10 ? 'text-amber-300' : 'text-slate-500'}`}>{len}/1000 · минимум 10 символов · ссылки запрещены</p>
      </div>
      {err && <p role="alert" className="notice-error">{err}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Отправка…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>Отмена</button>}
      </div>
    </form>
  )
}

function MuteNotice({ mute }) {
  return (
    <div role="alert" className="notice-error mb-4">
      <Ban className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        Вам ограничена публикация отзывов {mute.permanent ? 'без срока' : <>до {formatDateTime(mute.expires_at)}</>}. Причина: {mute.reason}
      </p>
    </div>
  )
}

// Панель «Ваш отзыв». Все решения (мут, лимиты, статус pending) принимает сервер; здесь только удобство.
function MyReviewPanel({ token, onChanged }) {
  const toast = useToast()
  const uid = token
  const account = useAsync(() => (uid ? myAccount() : null), [uid])
  const mine = useAsync(() => (uid ? myReview() : null), [uid])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!uid) return (
    <div className="card mb-6 p-5">
      <p className="text-slate-300">Чтобы оставить отзыв, войдите в аккаунт. Подтвердить владение Minecraft-аккаунтом можно в профиле: тогда рядом с ником появится значок.</p>
      <Link to="/account" className="btn-primary mt-3">Войти или зарегистрироваться</Link>
    </div>)
  // account.data === null — короткое окно между появлением сессии и началом загрузки: считаем это загрузкой
  if (account.loading || mine.loading || (!account.error && !account.data)) return <Loading />
  if (account.error || mine.error) return <ErrorBox message={account.error || mine.error} onRetry={() => { account.reload(); mine.reload() }} />
  const acc = account.data, r = mine.data
  const refresh = () => { mine.reload(); account.reload(); onChanged() }

  return (
    <div className="card mb-6 p-5">
      <h2 className="mb-4 font-display text-lg font-semibold tracking-tight text-white">Ваш отзыв</h2>
      {acc.mute && <MuteNotice mute={acc.mute} />}
      {!acc.nickname ? (
        <p className="text-slate-300">Сначала укажите игровой ник. <Link to="/account" className="text-accent-300 underline">Открыть профиль</Link></p>
      ) : r && !editing ? (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-3 text-sm"><Stars value={r.rating} /><span className="chip">{REVIEW_STATUSES[r.status]}</span></p>
          <p className="whitespace-pre-line break-words text-slate-200">{r.body}</p>
          {r.status === 'pending' && <p className="text-sm text-slate-400">Отзыв проверяется модератором и пока не виден другим посетителям.</p>}
          {r.status === 'rejected' && <p className="text-sm text-amber-300">Отзыв отклонён модератором. Вы можете изменить текст и отправить его повторно.</p>}
          {r.status === 'hidden' && <p className="text-sm text-amber-300">Отзыв скрыт модератором. Изменить его нельзя, но можно удалить.</p>}
          {r.status === 'approved' && <p className="text-sm text-slate-400">После изменения опубликованный отзыв снова уйдёт на модерацию.</p>}
          <div className="flex gap-2">
            {r.status !== 'hidden' && <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>Изменить</button>}
            <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}>Удалить</button>
          </div>
        </div>
      ) : (
        <ReviewForm
          key={r?.id ?? 'new'} initial={r} submitLabel={r ? 'Сохранить и отправить на модерацию' : 'Отправить на модерацию'}
          onCancel={r ? () => setEditing(false) : undefined}
          onSubmit={async (v) => {
            if (r) await editMyReview(v); else await submitReview(v)
            toast.success('Отзыв отправлен на модерацию'); setEditing(false); refresh()
          }}
        />)}
      {confirmDelete && (
        <ConfirmDialog title="Удалить отзыв?" text="Отзыв и ответ администрации к нему будут удалены без возможности восстановления." confirmLabel="Удалить" danger
          onClose={() => setConfirmDelete(false)} onConfirm={async () => { await deleteMyReview(); toast.success('Отзыв удалён'); refresh() }} />)}
    </div>
  )
}

function ReportDialog({ review, token, onClose }) {
  const toast = useToast()
  const [reason, setReason] = useState('spam')
  const [details, setDetails] = useState('')
  if (!token) return (
    <Dialog title="Пожаловаться на отзыв" onClose={onClose}>
      <p className="text-slate-300">Чтобы отправить жалобу, войдите в аккаунт.</p>
      <Link to="/account" className="btn-primary mt-4">Войти</Link>
    </Dialog>)
  return (
    <ConfirmDialog title="Пожаловаться на отзыв" confirmLabel="Отправить жалобу" onClose={onClose}
      onConfirm={async () => { await submitReport({ reviewId: review.id, reason, details }); toast.success('Жалоба отправлена модераторам') }}>
      <p className="line-clamp-3 break-words rounded-block bg-ink-900 p-2 text-sm text-slate-400">{review.author_name}: {review.body}</p>
      <div><label className="label" htmlFor="rep-reason">Причина</label>
        <select id="rep-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          {Object.entries(REPORT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      <div><label className="label" htmlFor="rep-details">Пояснение (необязательно)</label>
        <textarea id="rep-details" className="input min-h-20 py-2" maxLength={300} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
    </ConfirmDialog>
  )
}

export default function Reviews() {
  const token = usePlayer()
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [reporting, setReporting] = useState(null)
  const stats = useAsync(getReviewStats)
  const list = useAsync(() => listReviewsPage({ sort, page }), [sort, page])

  return (
    <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <PageHeader title="Отзывы" />
      {isSupabaseConfigured && <MyReviewPanel token={token} onChanged={() => { stats.reload(); list.reload() }} />}
      {stats.data && <Summary stats={stats.data} />}
      <div className="mb-4 flex items-center justify-end gap-2">
        <label className="text-sm text-slate-400" htmlFor="sort">Сортировка</label>
        <select id="sort" className="input w-auto" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1) }}>
          {Object.entries(REVIEW_SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {list.loading ? <Loading /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : list.data.items.length === 0 ? (
        <Empty title="Отзывов пока нет" text="Здесь появятся проверенные модератором отзывы игроков." />
      ) : (
        <>
          <div className="space-y-4">{list.data.items.map((r) => <ReviewCard key={r.id} r={r} onReport={setReporting} />)}</div>
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => { setPage(p); window.scrollTo({ top: 0 }) }} />
        </>)}
      {reporting && <ReportDialog review={reporting} token={token} onClose={() => setReporting(null)} />}
    </section>
  )
}
