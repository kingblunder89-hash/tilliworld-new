import { useState } from 'react'
import { Search, Coins, Plus, Trash2, Power } from 'lucide-react'
import { Loading, ErrorBox, Empty } from '../../components/States.jsx'
import { Time, Pager } from '../../components/ReviewUi.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { useToast } from '../../components/toastContext.js'
import { useAsync } from '../../hooks/useAsync.js'
import { useAuth } from '../../hooks/useAuth.js'
import { adminHas } from '../../lib/perms.js'
import { TX_KINDS, formatCoins, bpToPercent, parseAmount, validatePrizeRows } from '../../lib/economy.js'
import {
  adminEconomyPlayers, adminAdjustBalance, adminEconomyTransactions, adminWheelConfig, adminSetWheelEnabled, adminSetWheelPrizes, adminWheelSpins, adminWheelStats,
} from '../../services/economy.js'

const TABS = [['players', 'Игроки'], ['transactions', 'Операции'], ['wheel', 'Колесо'], ['spins', 'Спины и статистика']]
const tabCls = (on) => `rounded-block px-3 py-2 text-sm font-medium ${on ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`

function SearchBox({ placeholder, onSearch, label }) {
  const [input, setInput] = useState('')
  return (
    <form className="mb-4 flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); onSearch(input.trim()) }}>
      <input className="input w-72" placeholder={placeholder} aria-label={label} value={input} onChange={(e) => setInput(e.target.value)} />
      <button className="btn-ghost" aria-label="Искать"><Search className="size-4" aria-hidden="true" /></button>
    </form>
  )
}

function AdjustDialog({ player, onClose, onDone }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  return (
    <ConfirmDialog title={`Баланс: ${player.nickname}`} confirmLabel="Применить" onClose={onClose}
      text={`Сейчас на балансе ${formatCoins(player.balance)} монет. Положительное число — начисление, отрицательное (например, -100) — списание. Операция попадёт в журнал с вашим именем и причиной.`}
      onConfirm={async () => {
        const n = parseAmount(amount, { signed: true })
        if (n == null) throw new Error('Сумма: целое число (можно с минусом), не ноль, не больше 1 000 000 000.')
        if (reason.trim().length < 3) throw new Error('Укажите причину (минимум 3 символа).')
        const r = await adminAdjustBalance(player.id, n, reason.trim())
        toast.success(`Готово. Новый баланс: ${formatCoins(r.balance)}`); onDone()
      }}>
      <div><label className="label" htmlFor="adj-amount">Сумма (+ или −)</label><input id="adj-amount" className="input font-mono" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="например 500 или -200" autoComplete="off" required /></div>
      <div><label className="label" htmlFor="adj-reason">Причина (обязательно, до 300 символов)</label><input id="adj-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoComplete="off" required /></div>
    </ConfirmDialog>
  )
}

function Players({ canEdit }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState(null)
  const [history, setHistory] = useState(null)
  const state = useAsync(() => adminEconomyPlayers({ query, limit: 20, offset: (page - 1) * 20 }), [query, page])
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0
  return (
    <>
      <SearchBox placeholder="Ник или ID игрока" label="Поиск игроков" onSearch={(q) => { setQuery(q); setPage(1) }} />
      {state.loading ? <Loading /> : state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : state.data.length === 0 ? <Empty title="Игроков нет" /> : (
        <ul className="space-y-2">
          {state.data.map((p) => (
            <li key={p.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-bold text-white">{p.nickname}</p>
                <p className="text-xs text-slate-400">Последний спин: <Time iso={p.last_spin_at} /></p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1 text-lg font-extrabold text-amber-200"><Coins className="size-4" aria-hidden="true" />{formatCoins(p.balance)}</span>
                <button type="button" className="btn-ghost" onClick={() => setHistory(history === p.id ? null : p.id)}>{history === p.id ? 'Скрыть операции' : 'Операции'}</button>
                {canEdit && <button type="button" className="btn-primary" onClick={() => setTarget(p)}>Начислить / списать</button>}
              </div>
              {history === p.id && <div className="w-full"><TxList player={p.id} /></div>}
            </li>))}
        </ul>)}
      <Pager page={page} pageSize={20} total={total} onPage={setPage} />
      {target && <AdjustDialog player={target} onClose={() => setTarget(null)} onDone={state.reload} />}
    </>
  )
}

function TxList({ player = null, query = '' }) {
  const [page, setPage] = useState(1)
  const state = useAsync(() => adminEconomyTransactions({ player, query, limit: 30, offset: (page - 1) * 30 }), [player, query, page])
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0
  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />
  if (state.data.length === 0) return <Empty title="Операций нет" />
  return (
    <>
      <ul className="space-y-2">
        {state.data.map((t) => (
          <li key={t.id} className="card p-3 text-sm">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="rounded-block bg-white/10 px-2 py-0.5 text-xs font-bold text-slate-200">{TX_KINDS[t.kind] ?? t.kind}</span>
              <b className="text-white">{t.player_nickname}</b>
              <b className={t.amount > 0 ? 'text-emerald-300' : 'text-red-300'}>{t.amount > 0 ? '+' : '−'}{formatCoins(Math.abs(t.amount))}</b>
              <span className="text-slate-400">баланс {formatCoins(t.balance_after)}</span>
              {t.admin_name && <span className="text-slate-400">админ: {t.admin_name}</span>}
              <span className="text-slate-400"><Time iso={t.created_at} /></span>
            </p>
            {t.reason && <p className="mt-1 break-words text-slate-300">{t.reason}</p>}
          </li>))}
      </ul>
      <Pager page={page} pageSize={30} total={total} onPage={setPage} />
    </>
  )
}

function Transactions() {
  const [query, setQuery] = useState('')
  return (
    <>
      <p className="mb-3 text-sm text-slate-400">Журнал только для чтения: записи нельзя изменить или удалить, они остаются и после удаления аккаунта.</p>
      <SearchBox placeholder="Ник игрока, администратор или ID" label="Поиск по операциям" onSearch={setQuery} />
      <TxList query={query} />
    </>
  )
}

function WheelSettings({ canEdit }) {
  const toast = useToast()
  const state = useAsync(adminWheelConfig)
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [toggle, setToggle] = useState(false)
  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />
  const cfg = state.data
  const edit = rows ?? cfg.prizes.map((p) => ({ amount: String(p.amount), percent: bpToPercent(p.chance_bp) }))
  const check = validatePrizeRows(edit)
  const total = edit.reduce((s, r) => s + (Number(String(r.percent).replace(',', '.')) || 0), 0)
  const setRow = (i, patch) => { setRows(edit.map((r, j) => (j === i ? { ...r, ...patch } : r))); setErr('') }
  const save = async () => {
    if (check.error || busy) return setErr(check.error || '')
    setBusy(true); setErr('')
    try { await adminSetWheelPrizes(check.prizes); toast.success('Призы сохранены'); setRows(null); state.reload() } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }
  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-white">Колесо удачи: <b className={cfg.enabled ? 'text-emerald-300' : 'text-red-300'}>{cfg.enabled ? 'включено' : 'отключено'}</b> <span className="text-sm text-slate-400">· спин раз в {cfg.cooldown_hours} ч</span></p>
        {canEdit && <button type="button" className={cfg.enabled ? 'btn-danger' : 'btn-primary'} onClick={() => setToggle(true)}><Power className="size-4" aria-hidden="true" /> {cfg.enabled ? 'Отключить' : 'Включить'}</button>}
      </div>
      <section className="card space-y-3 p-4">
        <h2 className="font-bold text-white">Призы и вероятности</h2>
        <ul className="space-y-2">
          {edit.map((r, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <div><label className="label" htmlFor={`pa-${i}`}>Монет</label><input id={`pa-${i}`} className="input w-32 font-mono" inputMode="numeric" value={r.amount} disabled={!canEdit} onChange={(e) => setRow(i, { amount: e.target.value })} /></div>
              <div><label className="label" htmlFor={`pp-${i}`}>Вероятность, %</label><input id={`pp-${i}`} className="input w-32 font-mono" inputMode="decimal" value={r.percent} disabled={!canEdit} onChange={(e) => setRow(i, { percent: e.target.value })} /></div>
              {canEdit && <button type="button" className="btn-ghost" aria-label={`Удалить приз ${i + 1}`} disabled={edit.length <= 2} onClick={() => { setRows(edit.filter((_, j) => j !== i)); setErr('') }}><Trash2 className="size-4" aria-hidden="true" /></button>}
            </li>))}
        </ul>
        <p className={`text-sm ${check.totalBp === 10000 ? 'text-emerald-300' : 'text-red-300'}`} aria-live="polite">Сумма вероятностей: {Math.round(total * 100) / 100}% {check.totalBp === 10000 ? '(верно)' : '(нужно ровно 100%)'}</p>
        {(err || (check.error && rows)) && <p role="alert" className="text-sm text-red-300">{err || check.error}</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" disabled={edit.length >= 12} onClick={() => setRows([...edit, { amount: '', percent: '' }])}><Plus className="size-4" aria-hidden="true" /> Добавить приз</button>
            <button type="button" className="btn-primary" disabled={busy || Boolean(check.error)} onClick={save}>{busy ? 'Сохранение…' : 'Сохранить призы'}</button>
            {rows && <button type="button" className="btn-ghost" onClick={() => { setRows(null); setErr('') }}>Сбросить изменения</button>}
          </div>)}
        <p className="text-xs text-slate-500">От 2 до 12 призов. Вероятность задаётся с точностью до 0,01%. Изменения действуют на следующие спины.</p>
      </section>
      <section>
        <h2 className="mb-2 font-bold text-white">Последние изменения настроек</h2>
        {cfg.log.length === 0 ? <p className="text-sm text-slate-400">Изменений не было.</p> : (
          <ul className="space-y-1 text-sm text-slate-300">{cfg.log.map((l, i) => (
            <li key={i}>{{ wheel_enabled: 'Колесо включено', wheel_disabled: 'Колесо отключено', prizes_changed: 'Призы изменены' }[l.action]} · {l.admin_name} · <Time iso={l.occurred_at} /></li>))}</ul>)}
      </section>
      {toggle && <ConfirmDialog title={cfg.enabled ? 'Отключить колесо?' : 'Включить колесо?'} danger={cfg.enabled} confirmLabel={cfg.enabled ? 'Отключить' : 'Включить'} onClose={() => setToggle(false)}
        text={cfg.enabled ? 'Игроки не смогут крутить колесо, пока вы его не включите. Уже начисленные монеты сохранятся.' : 'Игроки снова смогут крутить колесо по своему таймеру.'}
        onConfirm={async () => { await adminSetWheelEnabled(!cfg.enabled); toast.success('Настройка сохранена'); state.reload() }} />}
    </div>
  )
}

function Spins() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const stats = useAsync(adminWheelStats)
  const state = useAsync(() => adminWheelSpins({ query, limit: 30, offset: (page - 1) * 30 }), [query, page])
  const total = state.data?.[0] ? Number(state.data[0].total_count) : 0
  const s = stats.data
  return (
    <div className="space-y-6">
      {stats.loading ? <Loading /> : stats.error ? <ErrorBox message={stats.error} onRetry={stats.reload} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[['Всего спинов', s.total_spins], ['За 24 часа', s.spins_24h], ['Игроков крутило', s.unique_players], ['Выплачено монет', formatCoins(s.total_paid)], ['Монет в обращении', formatCoins(s.coins_in_circulation)], ['Среднее за спин (расчёт)', Number(s.expected_per_spin).toLocaleString('ru-RU', { maximumFractionDigits: 2 })]].map(([l, v]) => (
              <div key={l} className="card p-4"><p className="font-display text-2xl font-semibold tabular-nums text-accent-200">{typeof v === 'number' ? formatCoins(v) : v}</p><p className="text-sm text-slate-400">{l}</p></div>))}
          </div>
          {s.by_prize.length > 0 && (
            <p className="text-sm text-slate-300">Выпадения: {s.by_prize.map((b) => `${formatCoins(b.amount)} — ${b.count}`).join(' · ')}</p>)}
        </>)}
      <div>
        <h2 className="mb-2 font-bold text-white">История спинов</h2>
        <SearchBox placeholder="Ник игрока или ID" label="Поиск по спинам" onSearch={(q) => { setQuery(q); setPage(1) }} />
        {state.loading ? <Loading /> : state.error ? <ErrorBox message={state.error} onRetry={state.reload} /> : state.data.length === 0 ? <Empty title="Спинов нет" /> : (
          <ul className="space-y-2">
            {state.data.map((r) => (
              <li key={r.id} className="card flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                <b className="text-white">{r.player_nickname}</b><b className="text-emerald-300">+{formatCoins(r.prize_amount)}</b>
                <span className="text-slate-400">шанс {bpToPercent(r.chance_bp)}%</span><span className="text-slate-400">статус: {r.status === 'completed' ? 'выполнен' : r.status}</span>
                <span className="text-slate-400"><Time iso={r.created_at} /></span>
              </li>))}
          </ul>)}
        <Pager page={page} pageSize={30} total={total} onPage={setPage} />
      </div>
    </div>
  )
}

export default function AdminEconomy() {
  const { session } = useAuth()
  const canEdit = adminHas(session?.user, 'economy')
  const [tab, setTab] = useState('players')
  if (!canEdit) return <ErrorBox message="Нужно право «economy» для раздела экономики." />
  return (
    <div>
      <h1 className="mb-2 font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">Экономика сайта</h1>
      <p className="mb-4 text-sm text-slate-400">Виртуальные монеты сайта. Не связаны с EssentialsX, Vault и игровым балансом Minecraft. Все изменения выполняет сервер и записывает в журнал.</p>
      <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Раздел">
        {TABS.map(([k, v]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={tabCls(tab === k)}>{v}</button>)}
      </div>
      {tab === 'players' && <Players canEdit={canEdit} />}
      {tab === 'transactions' && <Transactions />}
      {tab === 'wheel' && <WheelSettings canEdit={canEdit} />}
      {tab === 'spins' && <Spins />}
    </div>
  )
}
