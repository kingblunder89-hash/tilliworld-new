import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Info, Loader2, LockKeyhole, UserRound } from 'lucide-react'
import { playerLogin, playerRegister } from '../services/reviews.js'

const NICK_RE = /^[A-Za-z0-9_]{3,16}$/

// Регистрация и вход: только ник и пароль, без почты. Проверки дублируются в базе (player_register / player_login).
export default function AuthForm({ defaultMode = 'login' }) {
  const [mode, setMode] = useState(defaultMode)
  const [nick, setNick] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pending, setPending] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const login = nick.trim()
    setMsg('')
    if (mode === 'signup' && !NICK_RE.test(login)) return setMsg('Ник: 3–16 символов, латиница, цифры и _.')
    if (mode === 'signup' && password.length < 8) return setMsg('Пароль: минимум 8 символов.')
    setBusy(true)
    try {
      const r = await (mode === 'login' ? playerLogin : playerRegister)(login, password)
      if (r.status === 'pending_approval') { setPending(r.nickname); setPassword('') }
    } catch (ex) { setMsg(ex.message) }
    setBusy(false)
  }
  const switchMode = (next) => { if (busy || next === mode) return; setMode(next); setMsg('') }

  if (pending) return (
    <div className="card w-full max-w-md space-y-5 p-6 sm:p-8" role="status">
      <span className="grid size-12 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="size-6" aria-hidden="true" /></span>
      <h1 className="font-display text-xl font-semibold tracking-tight text-white">Заявка отправлена</h1>
      <p className="leading-relaxed text-slate-300">Аккаунт <b className="text-white">{pending}</b> создан и ждёт подтверждения администратором. Войти можно будет после одобрения: зайдите позже с тем же ником и паролем.</p>
      <button type="button" className="btn-ghost w-full" onClick={() => { setPending(null); setMode('login'); setMsg('') }}>Понятно</button>
    </div>
  )

  return (
    <form onSubmit={submit} className="card w-full max-w-md space-y-5 p-6 sm:p-8" aria-busy={busy}>
      <div role="group" aria-label="Вход или регистрация" className="grid grid-cols-2 gap-1 rounded-block border border-white/10 bg-ink-900 p-1">
        {[['login', 'Вход'], ['signup', 'Регистрация']].map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={busy}
            onClick={() => switchMode(m)}
            className={`min-h-10 rounded-lg text-sm font-semibold transition-colors ${mode === m ? 'bg-ink-600 text-white shadow-lift' : 'text-slate-400 hover:text-white'}`}
          >{label}</button>
        ))}
      </div>

      <h1 className="font-display text-xl font-semibold tracking-tight text-white">{mode === 'login' ? 'Вход игрока' : 'Регистрация игрока'}</h1>

      {msg && <p role="alert" className="notice-error"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{msg}</span></p>}

      <div>
        <label className="label" htmlFor="acc-nick-login">Ник</label>
        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input id="acc-nick-login" required className="input pl-10" value={nick} onChange={(e) => setNick(e.target.value)} autoComplete="username" maxLength={16} />
        </div>
        {mode === 'signup' && <p className="mt-1.5 text-xs text-slate-500">3–16 символов: латиница, цифры и _</p>}
      </div>

      <div>
        <label className="label" htmlFor="acc-pass">Пароль</label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input id="acc-pass" type={showPass ? 'text' : 'password'} required minLength={mode === 'login' ? 1 : 8} maxLength={72} className="input px-10" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          <button type="button" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPass} className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white">
            {showPass ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        </div>
        {mode === 'signup' && <p className="mt-1.5 text-xs text-slate-500">Минимум 8 символов</p>}
      </div>

      <button className="btn-primary min-h-12 w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
      </button>

      {mode === 'signup' && (
        <p className="notice-info text-xs leading-relaxed"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Почта не нужна. Запомните пароль: восстановить его по почте нельзя. Ник — это только имя, значок «Подтверждён» выдаётся после проверки в игре.</span></p>
      )}
    </form>
  )
}
