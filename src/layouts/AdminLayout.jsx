import { useState } from 'react'
import { NavLink, Link, Outlet } from 'react-router-dom'
import { LogOut, ShieldAlert } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { useAuth } from '../hooks/useAuth.js'
import { Loading } from '../components/States.jsx'
import { Logo, VoxelMark } from '../components/Brand.jsx'
import { useCounters } from '../hooks/useCounters.js'
import { adminHas } from '../lib/perms.js'

// [путь, подпись, end, право (только для показа вкладки; сервер проверяет права сам), ключ счётчика]
const tabs = [
  ['/admin', 'Обзор', true], ['/admin/orders', 'Заявки', false, 'shop'], ['/admin/products', 'Предметы', false, 'shop'],
  ['/admin/reviews', 'Отзывы', false, 'moderate', 'pending_reviews'], ['/admin/reports', 'Жалобы', false, 'moderate', 'open_reports'],
  ['/admin/accounts', 'Аккаунты', false, ['accounts', 'mutes', 'moderate'], 'pending_accounts'], ['/admin/economy', 'Экономика', false, 'economy'], ['/admin/mutes', 'Муты', false, 'mutes', 'active_mutes'], ['/admin/audit', 'Журнал', false, 'audit'],
]

function Panel({ session }) {
  const counters = useCounters()
  const visible = tabs.filter(([, , , perm]) => !perm || [].concat(perm).some((p) => adminHas(session.user, p)))
  return (
    <>
      <header className="mb-8 space-y-4 border-b border-white/[0.08] pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo to="/admin" />
            <span className="chip">Админ-панель</span>
          </div>
          <div className="flex gap-2">
            <Link to="/" className="btn-ghost">На сайт</Link>
            <button className="btn-ghost" onClick={() => supabase.auth.signOut()}><LogOut className="size-4" aria-hidden="true" /> Выйти</button>
          </div>
        </div>
        <nav className="flex flex-wrap gap-1" aria-label="Админ-навигация">
          {visible.map(([to, label, end, , key]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `rounded-block px-3 py-2 font-medium transition-colors ${isActive ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>
              {label}
              {key && counters?.[key] > 0 && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-xs font-bold ${key === 'active_mutes' ? 'bg-white/10 text-slate-300' : 'bg-red-400 text-ink-950'}`} aria-label={`${counters[key]} шт.`}>{counters[key]}</span>}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr('Неверная почта или пароль.')
    setBusy(false)
  }
  return (
    <form onSubmit={submit} className="card mx-auto mt-16 w-full max-w-sm space-y-5 p-6 sm:p-8">
      <VoxelMark className="size-10" />
      <h1 className="font-display text-xl font-semibold tracking-tight text-white">Вход для администратора</h1>
      {err && <p role="alert" className="notice-error">{err}</p>}
      <div><label className="label" htmlFor="em">Почта</label><input id="em" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
      <div><label className="label" htmlFor="pw">Пароль</label><input id="pw" type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
      <button className="btn-primary min-h-12 w-full" disabled={busy}>{busy ? 'Вход…' : 'Войти'}</button>
      <p className="text-xs text-slate-500">Регистрация администраторов закрыта. Аккаунт создаётся владельцем через Supabase.</p>
    </form>
  )
}

export default function AdminLayout() {
  const { session, loading, isAdmin } = useAuth()
  const wrap = (c) => <div className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">{c}</div>

  if (!isSupabaseConfigured) return wrap(
    <div className="card mx-auto mt-16 max-w-xl p-6 text-slate-300">
      <ShieldAlert className="size-8 text-amber-300" aria-hidden="true" />
      <h1 className="mt-3 font-display text-xl font-semibold tracking-tight text-white">Админ-панель не настроена</h1>
      <p className="mt-2">Создайте проект Supabase, примените миграцию и заполните <code>.env</code> (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). Затем назначьте администратора вручную — шаги в README, раздел «Первый администратор».</p>
      <Link to="/" className="btn-ghost mt-4">На сайт</Link>
    </div>)
  if (loading) return wrap(<Loading />)
  if (!session) return wrap(<Login />)
  if (!isAdmin) return wrap(
    <div className="card mx-auto mt-16 max-w-md p-6 text-center">
      <h1 className="font-display text-xl font-semibold tracking-tight text-white">Нет доступа</h1>
      <p className="mt-2 text-slate-400">У этого аккаунта нет роли администратора.</p>
      <button className="btn-ghost mt-4" onClick={() => supabase.auth.signOut()}>Выйти</button>
    </div>)

  return wrap(<Panel session={session} />)
}
