import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Coins, Clock } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase.js'
import { useEconomy } from '../hooks/useEconomy.js'
import { useToast } from '../components/toastContext.js'
import { Loading, ErrorBox } from '../components/States.jsx'
import Transactions from '../components/Transactions.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { wheelSpin, refreshEconomy } from '../services/economy.js'
import { formatCoins, formatCountdown, secondsLeft, targetRotation, bpToPercent } from '../lib/economy.js'

const COLORS = ['#5b3fd1', '#1f4fa8', '#7c3aed', '#183f86', '#6d28d9', '#2559b3', '#4c2fb8', '#1b4896', '#6b3fd6', '#2a62c2', '#5a37c4', '#163a78']
const R = 96
const point = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)] }

function WheelSvg({ prizes, rotation, spinning, reduced }) {
  const n = prizes.length
  const step = 360 / n
  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm">
      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1" aria-hidden="true">
        <div className="size-0 border-x-[12px] border-t-[22px] border-x-transparent border-t-accent-300 drop-shadow" />
      </div>
      <svg viewBox="-100 -100 200 200" className="size-full" role="img" aria-label={`Колесо удачи: призы ${prizes.map((p) => p.amount).join(', ')} монет`}
        style={{ transform: `rotate(${rotation}deg)`, transition: spinning && !reduced ? 'transform 4s cubic-bezier(0.12, 0.7, 0.1, 1)' : 'none' }}>
        <circle r={R + 3} fill="#09090d" stroke="#c4b5fd" strokeWidth="2" />
        {prizes.map((p, i) => {
          const [x1, y1] = point(i * step, R), [x2, y2] = point((i + 1) * step, R)
          const mid = (i + 0.5) * step, [tx, ty] = point(mid, R * 0.68)
          return (
            <g key={i}>
              <path d={`M0 0 L${x1} ${y1} A${R} ${R} 0 ${step > 180 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={COLORS[i % COLORS.length]} stroke="#09090d" strokeWidth="1" />
              <text x={tx} y={ty} fill="#fff" fontSize={n > 8 ? 8 : 10} fontWeight="700" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${mid} ${tx} ${ty})`}>{formatCoins(p.amount)}</text>
            </g>)
        })}
        <circle r="8" fill="#09090d" stroke="#c4b5fd" strokeWidth="2" />
      </svg>
    </div>
  )
}

export default function Wheel() {
  const toast = useToast()
  const { data, error, loading, offset, reload } = useEconomy()
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [shown, setShown] = useState(null)  // баланс, который показываем (обновляется после анимации)
  const [stale, setStale] = useState(false) // после спина данные ещё не перечитаны с сервера
  const [, tick] = useState(0)
  const reduced = useRef(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const timer = useRef(null)
  const rotationRef = useRef(0)

  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => { clearInterval(t); clearTimeout(timer.current) } }, [])

  useEffect(() => { setStale(false); setShown(null) }, [data])

  const wheel = data?.wheel
  const left = wheel ? secondsLeft(wheel.next_spin_at, offset) : 0
  // таймер дошёл до нуля — спрашиваем сервер (он решает, доступен ли спин)
  useEffect(() => { if (wheel && wheel.next_spin_at && left === 0 && !busy && !spinning) reload() }, [wheel, left, busy, spinning, reload])

  const spin = async () => {
    if (busy || spinning) return // защита от двойного клика; от повторных запросов защищает и сервер
    setBusy(true); setResult(null)
    try {
      const r = await wheelSpin()                  // приз уже определён сервером и начислен
      const n = wheel.prizes.length
      const next = targetRotation(rotationRef.current, r.prize_index, n)
      rotationRef.current = next
      setSpinning(true); setRotation(next)
      timer.current = setTimeout(() => {
        setSpinning(false); setResult(r); setShown(r.balance); setStale(true); setBusy(false)
        toast.success(`Вы выиграли ${formatCoins(r.prize_amount)} монет!`)
        refreshEconomy()
      }, reduced.current ? 50 : 4200)
    } catch (ex) {
      toast.error(ex.message); setBusy(false); reload()
    }
  }

  if (!isSupabaseConfigured) return <section className="mx-auto max-w-3xl px-4 py-12"><ErrorBox message="Экономика недоступна: Supabase не настроен." /></section>
  if (loading && !data) return <section className="mx-auto max-w-3xl px-4 py-12"><Loading /></section>
  if (error && !data) return <section className="mx-auto max-w-3xl px-4 py-12"><ErrorBox message={error} onRetry={reload} /></section>
  const balance = shown ?? data.balance
  const canSpin = wheel.enabled && wheel.can_spin && left === 0 && !stale

  return (
    <section className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <PageHeader
        title="Колесо удачи"
        actions={(
          <p className="flex items-center gap-2 rounded-block border border-amber-300/25 bg-amber-300/[0.08] px-4 py-2 text-xl font-bold tabular-nums text-amber-200" aria-live="polite">
            <Coins className="size-5" aria-hidden="true" /> {formatCoins(balance)} <span className="text-sm font-medium text-amber-200/70">монет</span>
          </p>
        )}
      >
        Один бесплатный спин каждые {wheel.cooldown_hours} часа. Монеты действуют только на сайте и не связаны с игровым балансом Minecraft.
      </PageHeader>

      <div className="card space-y-6 p-6 sm:p-8">
        <WheelSvg prizes={wheel.prizes} rotation={rotation} spinning={spinning} reduced={reduced.current} />
        <div className="text-center" aria-live="polite">
          {!wheel.enabled ? <p className="text-slate-300">Колесо сейчас отключено администратором.</p>
            : spinning || busy ? <p className="text-slate-300">Крутим…</p>
            : result ? <p className="font-display text-lg font-semibold text-accent-200">Приз: {formatCoins(result.prize_amount)} монет!</p>
            : null}
          {wheel.enabled && !canSpin && !spinning && !busy && !stale && (
            <p className="mt-1 inline-flex items-center gap-2 text-slate-300"><Clock className="size-4" aria-hidden="true" /> Следующий спин через <b className="tabular-nums text-white">{formatCountdown(left)}</b></p>)}
        </div>
        <div className="flex justify-center">
          <button type="button" className="btn-primary min-h-12 min-w-56 px-8" onClick={spin} disabled={!canSpin || busy || spinning}>{busy || spinning ? 'Крутим…' : 'Крутить колесо'}</button>
        </div>
        <details className="rounded-block border border-white/10 bg-ink-900 p-3.5 text-sm text-slate-400">
          <summary className="cursor-pointer font-medium text-slate-200">Призы и шансы</summary>
          <ul className="mt-3 grid gap-1.5 tabular-nums sm:grid-cols-2">{wheel.prizes.map((p, i) => <li key={i}>{formatCoins(p.amount)} монет — {bpToPercent(p.chance_bp)}%</li>)}</ul>
        </details>
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-white">История операций</h2>
        <Transactions />
      </section>
      <p className="text-sm text-slate-500"><Link to="/account" className="text-accent-300 underline hover:text-accent-200">Вернуться в аккаунт</Link></p>
    </section>
  )
}
