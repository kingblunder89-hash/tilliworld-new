import { useState } from 'react'
import { Search, BadgeCheck, Ban, KeyRound, LogOut, Unlink, Trash2, Copy, Wand2, Check, X } from 'lucide-react'
import { Loading, ErrorBox, Empty } from '../../components/States.jsx'
import { Time, Pager, Stars } from '../../components/ReviewUi.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import MuteDialog from '../../components/MuteDialog.jsx'
import { useToast } from '../../components/toastContext.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useAuth } from '../../hooks/useAuth.js'
import { refreshCounters } from '../../hooks/useCounters.js'
import { adminHas } from '../../lib/perms.js'
import { ACCOUNT_ACTIONS, REVIEW_STATUSES } from '../../lib/reviewErrors.js'
import { durationLabel } from '../../lib/time.js'
import {
  adminListAccounts, adminAccountDetail, adminApprovePlayer, adminRejectPlayer, adminResetPassword, adminRevokeSessions, adminUnlinkMinecraft, adminDeletePlayer, adminAccountActions,
} from '../../services/reviews.js'

const PAGE = 20
const FILTERS = [['all', 'Все'], ['pending', 'Ожидают подтверждения'], ['rejected', 'Отклонённые'], ['verified', 'Подтверждённые'], ['unverified', 'Не подтверждённые'], ['muted', 'В муте']]
const APPROVAL = { pending: 'ожидает подтверждения', approved: 'одобрен', rejected: 'отклонён' }
const MUTE_LABEL = { active: 'активен', expired: 'истёк', lifted: 'снят' }

// Случайный пароль без похожих символов (0/O, 1/l/I). Генерируется в браузере и сразу уходит на сервер, нигде не сохраняется.
function generatePassword(len = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  return Array.from(buf, (n) => chars[n % chars.length]).join('')
}

function PasswordDialog({ account, onClose, onDone }) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  return (
    <ConfirmDialog title={`Новый пароль: ${account.nickname}`} confirmLabel="Сменить пароль" onClose={onClose}
      text="Старый пароль узнать нельзя, его можно только заменить. Все сессии игрока будут завершены. Передайте новый пароль игроку лично и попросите сменить его."
      onConfirm={async () => {
        if (password.length < 8) throw new Error('Пароль: минимум 8 символов.')
        await adminResetPassword(account.id, password); toast.success('Пароль изменён, сессии игрока завершены'); onDone()
      }}>
      <div>
        <label className="label" htmlFor="new-pass">Новый пароль (8–72 символа)</label>
        <div className="flex gap-2">
          <input id="new-pass" className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} autoComplete="off" required />
          <button type="button" className="btn-ghost" onClick={() => setPassword(generatePassword())} aria-label="Сгенерировать пароль"><Wand2 className="size-4" aria-hidden="true" /></button>
          <button type="button" className="btn-ghost" disabled={!password} onClick={() => navigator.clipboard?.writeText(password).then(() => toast.success('Пароль скопирован'), () => {})} aria-label="Копировать пароль"><Copy className="size-4" aria-hidden="true" /></button>
        </div>
      </div>
    </ConfirmDialog>
  )
}

function RejectDialog({ account, onClose, onDone }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  return (
    <ConfirmDialog title={`Отклонить регистрацию: ${account.nickname}`} confirmLabel="Отклонить" danger onClose={onClose}
      text="Игрок не сможет войти, ник останется занятым. Причину он увидит при попытке входа. Позже заявку можно одобрить или удалить аккаунт."
      onConfirm={async () => {
        if (reason.trim().length < 3) throw new Error('Укажите причину (минимум 3 символа).')
        await adminRejectPlayer(account.id, reason); toast.success('Регистрация отклонена'); onDone()
      }}>
      <div><label className="label" htmlFor="rej-reason">Причина (до 300 символов)</label>
        <input id="rej-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoComplete="off" required /></div>
    </ConfirmDialog>
  )
}

function DeleteDialog({ account, onClose, onDone }) {
  const toast = useToast()
  const [nick, setNick] = useState('')
  const [withReviews, setWithReviews] = useState(false)
  return (
    <ConfirmDialog title={`Удалить аккаунт ${account.nickname}?`} confirmLabel="Удалить навсегда" danger onClose={onClose}
      text="Аккаунт, профиль, привязка Minecraft и сессии будут удалены без возможности восстановления. Записи о мутах и журнал останутся. Игрок сможет зарегистрироваться заново, мут на новый аккаунт не переносится."
      onConfirm={async () => { await adminDeletePlayer({ id: account.id, nickname: nick, deleteReviews: withReviews }); toast.success('Аккаунт удалён'); onDone() }}>
      <div><label className="label" htmlFor="del-nick">Для подтверждения введите ник: <b className="text-white">{account.nickname}</b></label>
        <input id="del-nick" className="input" value={nick} onChange={(e) => setNick(e.target.value)} autoComplete="off" required /></div>
      <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={withReviews} onChange={(e) => setWithReviews(e.target.checked)} /> Удалить также отзыв игрока (иначе он останется как «старый»)</label>
    </ConfirmDialog>
  )
}

function Details({ id, user, onChanged }) {
  const toast = useToast()
  const state = useAsync(() => adminAccountDetail(id), [id])
  const [dialog, setDialog] = useState(null)
  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />
  const d = state.data
  const canManage = adminHas(user, 'accounts')
  const activeMute = d.mutes.find((m) => m.status === 'active')
  const changed = () => { state.reload(); onChanged() }
  const close = () => setDialog(null)

  return (
    <div className="mt-3 space-y-4 border-t border-white/10 pt-3 text-sm">
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div><dt className="inline text-slate-500">ID аккаунта: </dt><dd className="inline break-all text-slate-300">{d.id}</dd></div>
        <div><dt className="inline text-slate-500">Регистрация: </dt><dd className="inline text-slate-300"><Time iso={d.created_at} /></dd></div>
        <div><dt className="inline text-slate-500">Активных сессий: </dt><dd className="inline text-slate-300">{d.sessions.count}</dd></div>
        <div><dt className="inline text-slate-500">Последний вход: </dt><dd className="inline text-slate-300"><Time iso={d.sessions.last_at} /></dd></div>
        <div><dt className="inline text-slate-500">Жалоб подано / на отзыв: </dt><dd className="inline text-slate-300">{d.reports_filed} / {d.reports_against}</dd></div>
        <div><dt className="inline text-slate-500">Регистрация: </dt><dd className="inline text-slate-300">{APPROVAL[d.approval.status]}{d.approval.decided_by_name ? <> · {d.approval.decided_by_name}, <Time iso={d.approval.decided_at} /></> : null}{d.approval.reject_reason ? ` · ${d.approval.reject_reason}` : ''}</dd></div>
        <div><dt className="inline text-slate-500">Пароль: </dt><dd className="inline text-slate-300">хранится только в виде хэша, посмотреть нельзя</dd></div>
      </dl>
      <div>
        <h3 className="mb-1 font-bold text-white">Minecraft</h3>
        {d.minecraft ? <p className="break-all text-slate-300">Подтверждён: <b>{d.minecraft.mc_name}</b> · UUID {d.minecraft.mc_uuid} · <Time iso={d.minecraft.verified_at} /></p> : <p className="text-slate-400">Не подтверждён.</p>}
      </div>
      <div>
        <h3 className="mb-1 font-bold text-white">Отзыв</h3>
        {d.review ? (
          <div className="rounded-block bg-ink-900 p-3">
            <p className="flex flex-wrap items-center gap-3 text-slate-300"><Stars value={d.review.rating} /> {REVIEW_STATUSES[d.review.status]} · <Time iso={d.review.created_at} /></p>
            <p className="mt-1 whitespace-pre-line break-words text-slate-200">{d.review.body}</p>
          </div>) : <p className="text-slate-400">Отзыва нет.</p>}
      </div>
      <div>
        <h3 className="mb-1 font-bold text-white">Муты ({d.mutes.length})</h3>
        {d.mutes.length === 0 ? <p className="text-slate-400">Не было.</p> : (
          <ul className="space-y-1 text-slate-300">{d.mutes.map((m) => (
            <li key={m.id}><b className={m.status === 'active' ? 'text-red-300' : ''}>{MUTE_LABEL[m.status]}</b> · {durationLabel(m.duration_key)} · <Time iso={m.created_at} /> · {m.issued_by_name} · {m.reason}</li>))}</ul>)}
      </div>
      <div>
        <h3 className="mb-1 font-bold text-white">Действия администраторов над аккаунтом</h3>
        {d.actions.length === 0 ? <p className="text-slate-400">Не было.</p> : (
          <ul className="space-y-1 text-slate-300">{d.actions.map((a, i) => (
            <li key={i}>{ACCOUNT_ACTIONS[a.action]} · {a.admin_name} · <Time iso={a.occurred_at} />{a.note ? ` · ${a.note}` : ''}</li>))}</ul>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {adminHas(user, 'mutes') && !activeMute && <button type="button" className="btn-ghost" onClick={() => setDialog('mute')}><Ban className="size-4" aria-hidden="true" /> Выдать мут</button>}
        {canManage ? (
          <>
            {d.approval.status !== 'approved' && <button type="button" className="btn-primary" onClick={() => setDialog('approve')}><Check className="size-4" aria-hidden="true" /> Одобрить регистрацию</button>}
            {d.approval.status !== 'rejected' && <button type="button" className="btn-ghost" onClick={() => setDialog('reject')}><X className="size-4" aria-hidden="true" /> Отклонить регистрацию</button>}
            <button type="button" className="btn-ghost" onClick={() => setDialog('password')}><KeyRound className="size-4" aria-hidden="true" /> Сменить пароль</button>
            <button type="button" className="btn-ghost" onClick={() => setDialog('sessions')}><LogOut className="size-4" aria-hidden="true" /> Завершить все сессии</button>
            {d.minecraft && <button type="button" className="btn-ghost" onClick={() => setDialog('unlink')}><Unlink className="size-4" aria-hidden="true" /> Отвязать Minecraft</button>}
            <button type="button" className="btn-danger" onClick={() => setDialog('delete')}><Trash2 className="size-4" aria-hidden="true" /> Удалить аккаунт</button>
          </>) : <p className="text-xs text-slate-500">Для сброса пароля и удаления нужно право «accounts».</p>}
      </div>
      {dialog === 'mute' && <MuteDialog target={{ userId: d.id, nickname: d.nickname }} onClose={close} onDone={changed} />}
      {dialog === 'reject' && <RejectDialog account={d} onClose={close} onDone={changed} />}
      {dialog === 'approve' && <ConfirmDialog title={`Одобрить регистрацию ${d.nickname}?`} text="Игрок сможет войти на сайт со своим ником и паролем." confirmLabel="Одобрить" onClose={close}
        onConfirm={async () => { await adminApprovePlayer(d.id); toast.success('Регистрация одобрена'); changed() }} />}
      {dialog === 'password' && <PasswordDialog account={d} onClose={close} onDone={changed} />}
      {dialog === 'delete' && <DeleteDialog account={d} onClose={close} onDone={onChanged} />}
      {dialog === 'sessions' && <ConfirmDialog title="Завершить все сессии?" text={`Игрок ${d.nickname} будет выброшен со всех устройств и должен войти заново.`} confirmLabel="Завершить" onClose={close}
        onConfirm={async () => { const n = await adminRevokeSessions(d.id); toast.success(`Завершено сессий: ${n}`); changed() }} />}
      {dialog === 'unlink' && <ConfirmDialog title="Отвязать Minecraft-аккаунт?" danger confirmLabel="Отвязать" onClose={close}
        text="У игрока пропадёт значок «Подтверждён». Мут (если есть) продолжит действовать на этот Minecraft-аккаунт."
        onConfirm={async () => { await adminUnlinkMinecraft(d.id); toast.success('Minecraft-аккаунт отвязан'); changed() }} />}
    </div>
  )
}

function Accounts({ user }) {
  const [filter, setFilter] = useState('all')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(null)
  const state = useAsync(() => adminListAccounts({ filter, query, limit: PAGE, offset: (page - 1) * PAGE }), [filter, query, page])
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0
  const refresh = () => { state.reload(); refreshCounters() }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Фильтр аккаунтов">
          {FILTERS.map(([k, v]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setPage(1); setOpen(null) }}
              className={`rounded-block px-3 py-2 text-sm font-medium ${filter === k ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>{v}</button>))}
        </div>
        <form className="ml-auto flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()); setPage(1); setOpen(null) }}>
          <input className="input w-60" placeholder="Ник, Minecraft-ник, UUID или ID" aria-label="Поиск аккаунтов" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn-ghost" aria-label="Искать"><Search className="size-4" aria-hidden="true" /></button>
        </form>
      </div>
      {state.loading ? <Loading /> : state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : state.data.length === 0 ? <Empty title="Аккаунтов нет" text="По выбранным фильтрам ничего не найдено." /> : (
        <ul className="space-y-3">
          {state.data.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-base font-bold text-white">{a.nickname}
                    {a.approval_status === 'pending' && <span className="rounded-block bg-amber-400/15 px-1.5 py-0.5 text-xs font-normal text-amber-300">ожидает подтверждения</span>}
                    {a.approval_status === 'rejected' && <span className="rounded-block bg-red-400/15 px-1.5 py-0.5 text-xs font-normal text-red-300">отклонён</span>}
                    {a.verified ? <span className="inline-flex items-center gap-1 rounded-block bg-volt-500/15 px-1.5 py-0.5 text-xs text-volt-300"><BadgeCheck className="size-3.5" aria-hidden="true" /> Подтверждён: {a.mc_name}</span>
                      : <span className="rounded-block bg-white/10 px-1.5 py-0.5 text-xs font-normal text-slate-400">не подтверждён</span>}
                    {a.is_muted && <span className="inline-flex items-center gap-1 rounded-block bg-red-400/15 px-1.5 py-0.5 text-xs text-red-300"><Ban className="size-3" aria-hidden="true" /> мут {a.mute_permanent ? 'без срока' : <>до <Time iso={a.mute_expires_at} /></>}</span>}
                    {a.review_status && <span className="rounded-block bg-white/10 px-1.5 py-0.5 text-xs font-normal text-slate-300">отзыв: {REVIEW_STATUSES[a.review_status]}</span>}
                  </p>
                  <p className="text-sm text-slate-400">Регистрация <Time iso={a.created_at} /> · последний вход <Time iso={a.last_session_at} /></p>
                </div>
                <button type="button" className="btn-ghost" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Свернуть' : 'Подробнее'}</button>
              </div>
              {open === a.id && <Details id={a.id} user={user} onChanged={() => { setOpen(null); refresh() }} />}
            </li>))}
        </ul>)}
      <Pager page={page} pageSize={PAGE} total={total} onPage={(p) => { setPage(p); setOpen(null) }} />
    </>
  )
}

function ActionsLog() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const state = useAsync(() => adminAccountActions({ query, limit: 30, offset: (page - 1) * 30 }), [query, page])
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0
  return (
    <>
      <p className="mb-3 text-sm text-slate-400">Журнал только для чтения: записи нельзя изменить или удалить, они остаются и после удаления аккаунта.</p>
      <form className="mb-4 flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()); setPage(1) }}>
        <input className="input w-72" placeholder="Ник игрока, администратор или ID" aria-label="Поиск по журналу" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn-ghost" aria-label="Искать"><Search className="size-4" aria-hidden="true" /></button>
      </form>
      {state.loading ? <Loading /> : state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : state.data.length === 0 ? <Empty title="Записей нет" /> : (
        <ul className="space-y-2">
          {state.data.map((a) => (
            <li key={a.id} className="card p-3 text-sm">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded-block bg-white/10 px-2 py-0.5 text-xs font-bold text-slate-200">{ACCOUNT_ACTIONS[a.action]}</span>
                <b className="text-white">{a.player_nickname}</b><span className="text-slate-400">админ: {a.admin_name}</span><span className="text-slate-400"><Time iso={a.occurred_at} /></span>
              </p>
              {a.note && <p className="mt-1 break-words text-slate-300">{a.note}</p>}
            </li>))}
        </ul>)}
      <Pager page={page} pageSize={30} total={total} onPage={setPage} />
    </>
  )
}

export default function AdminAccounts() {
  const { session } = useAuth()
  const user = session?.user
  const [tab, setTab] = useState('accounts')
  return (
    <div>
      <h1 className="mb-2 font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">Аккаунты игроков</h1>
      <p className="mb-4 text-sm text-slate-400">Игроки входят по нику и паролю. Пароль хранится только в виде хэша: его нельзя посмотреть, но можно заменить на новый.</p>
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Раздел">
        <button type="button" role="tab" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')} className={`rounded-block px-3 py-2 text-sm font-medium ${tab === 'accounts' ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>Аккаунты</button>
        {adminHas(user, 'accounts') && <button type="button" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')} className={`rounded-block px-3 py-2 text-sm font-medium ${tab === 'log' ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>Журнал действий</button>}
      </div>
      {tab === 'accounts' ? <Accounts user={user} /> : <ActionsLog />}
    </div>
  )
}
