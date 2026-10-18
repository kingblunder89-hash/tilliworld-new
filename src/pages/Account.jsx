import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Ban, Copy, LogOut } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase.js'
import { usePlayer } from '../hooks/usePlayer.js'
import { useAsync } from '../hooks/useAsync.js'
import { useToast } from '../components/toastContext.js'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { Loading, ErrorBox } from '../components/States.jsx'
import { Time } from '../components/ReviewUi.jsx'
import { SERVER_IP } from '../config/server.js'
import { formatDateTime } from '../lib/time.js'
import AuthForm from '../components/AuthForm.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import Transactions from '../components/Transactions.jsx'
import MyOrders from '../components/MyOrders.jsx'
import { useEconomy } from '../hooks/useEconomy.js'
import { formatCoins } from '../lib/economy.js'
import { myAccount, createLinkCode, unlinkMinecraft, playerLogout } from '../services/reviews.js'

const VERIFY_COMMAND = '/tilliverify'

function VerifyBlock({ account, onVerified }) {
  const toast = useToast()
  const [code, setCode] = useState(null) // { code, expires_at }
  const [busy, setBusy] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [, tick] = useState(0)

  // Пока код активен, раз в 4 секунды спрашиваем сервер: подтверждение происходит в игре, а не на сайте.
  useEffect(() => {
    if (!code || account.verified) return undefined
    const poll = setInterval(async () => {
      try { const a = await myAccount(); if (a.verified) { setCode(null); toast.success('Minecraft-аккаунт подтверждён'); onVerified() } } catch { /* повторим */ }
      tick((n) => n + 1)
    }, 4000)
    return () => clearInterval(poll)
  }, [code, account.verified, onVerified, toast])

  const left = code ? Math.max(0, Math.floor((new Date(code.expires_at) - Date.now()) / 1000)) : 0
  const request = async () => {
    setBusy(true)
    try { setCode(await createLinkCode()) } catch (ex) { toast.error(ex.message) }
    setBusy(false)
  }

  if (account.verified) return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-slate-200"><BadgeCheck className="size-5 text-volt-300" aria-hidden="true" /> Подтверждён: <b className="text-white">{account.mc_name}</b> <span className="text-sm text-slate-400">с <Time iso={account.verified_at} /></span></p>
      <p className="text-sm text-slate-400">Рядом с вашим ником в отзывах показывается значок «Подтверждён».</p>
      <button type="button" className="btn-ghost" onClick={() => setUnlinking(true)}>Отвязать Minecraft-аккаунт</button>
      {unlinking && <ConfirmDialog title="Отвязать аккаунт?" text="Значок подтверждения пропадёт. Вернуть его можно, пройдя проверку заново." confirmLabel="Отвязать" danger
        onClose={() => setUnlinking(false)} onConfirm={async () => { await unlinkMinecraft(); toast.success('Аккаунт отвязан'); onVerified() }} />}
    </div>)

  return (
    <div className="space-y-3">
      <p className="text-slate-300">Введённый ник ничего не доказывает, поэтому значок выдаётся только после проверки в игре: вы заходите на наш сервер под своим аккаунтом и вводите одноразовый код.</p>
      {!code || left === 0 ? (
        <button type="button" className="btn-primary min-h-12 px-6" onClick={request} disabled={busy}>{code ? 'Получить новый код' : 'Получить код подтверждения'}</button>
      ) : (
        <div className="rounded-xl border border-accent-400/25 bg-accent-500/[0.06] p-4">
          <p className="text-sm text-slate-300">1. Зайдите на сервер <b className="text-white">{SERVER_IP}</b> под своим аккаунтом.<br />2. Введите в игровом чате:</p>
          <p className="mt-2 flex flex-wrap items-center gap-3">
            <code className="rounded-block border border-white/10 bg-ink-900 px-3 py-2 text-lg font-bold text-accent-200">{VERIFY_COMMAND} {code.code}</code>
            <button type="button" className="btn-ghost" onClick={() => navigator.clipboard?.writeText(`${VERIFY_COMMAND} ${code.code}`).then(() => toast.success('Команда скопирована'), () => {})}><Copy className="size-4" aria-hidden="true" /> Копировать</button>
          </p>
          <p className="mt-2 text-xs text-slate-400" aria-live="polite">Код действует ещё {Math.floor(left / 60)} мин {left % 60} с и работает один раз. Страница сама обновится после подтверждения.</p>
        </div>)}
    </div>
  )
}

function Balance() {
  const { data } = useEconomy()
  if (!data) return null
  return (
    <>
      <section className="card p-6" aria-labelledby="balance-title">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="balance-title" className="text-sm font-medium text-slate-400">Баланс</h2>
            <p className="mt-1 flex items-baseline gap-2 text-4xl font-bold tabular-nums text-amber-200">{formatCoins(data.balance)} <span className="text-sm font-medium text-slate-400">монет</span></p>
          </div>
          <Link to="/wheel" className="btn-ghost">Колесо удачи</Link>
        </div>
        <p className="mt-4 text-sm text-slate-400">Монеты действуют только на сайте и не связаны с игровым балансом Minecraft.</p>
      </section>
      <section className="card space-y-4 p-6">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">История операций</h2>
        <Transactions />
      </section>
    </>
  )
}

function Profile({ token }) {
  const state = useAsync(myAccount, [token])
  if (state.loading) return <Loading />
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />
  const a = state.data
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Аккаунт" actions={<button type="button" className="btn-ghost" onClick={playerLogout}><LogOut className="size-4" aria-hidden="true" /> Выйти</button>} />
      <section className="card flex flex-wrap items-center gap-4 p-6" aria-label="Данные игрока">
        <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-accent-400/25 bg-accent-500/10 font-display text-xl font-semibold text-accent-200" aria-hidden="true">{(a.nickname || '?').slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="text-sm text-slate-400">Логин</p>
          <p className="truncate text-lg font-semibold text-white">{a.nickname}</p>
        </div>
        {a.verified && <span className="chip ml-auto border-volt-400/30 bg-volt-500/10 text-volt-300"><BadgeCheck className="size-3.5" aria-hidden="true" /> Minecraft подтверждён</span>}
      </section>
      {a.mute && (
        <div role="alert" className="notice-error">
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>Публикация отзывов ограничена {a.mute.permanent ? 'без срока' : <>до {formatDateTime(a.mute.expires_at)}</>}. Причина: {a.mute.reason}</p>
        </div>)}
      <Balance />
      <section className="card space-y-4 p-6">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">Мои покупки</h2>
        <p className="text-sm text-slate-400">Предметы выдаёт администратор вручную: пока заказ не отмечен выполненным, предмет не считается выданным.</p>
        <MyOrders />
      </section>
      <section className="card space-y-4 p-6"><h2 className="font-display text-lg font-semibold tracking-tight text-white">Подтверждение Minecraft-аккаунта</h2><VerifyBlock account={a} onVerified={state.reload} /></section>
      <p className="text-sm text-slate-400">Оставить или изменить отзыв можно на странице <Link to="/reviews" className="text-accent-300 underline hover:text-accent-200">«Отзывы»</Link>.</p>
    </div>
  )
}

export default function Account() {
  const token = usePlayer()
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      {!isSupabaseConfigured ? <ErrorBox message="Аккаунты игроков недоступны: Supabase не настроен." /> : !token ? <div className="flex justify-center"><AuthForm /></div> : <Profile token={token} />}
    </section>
  )
}
