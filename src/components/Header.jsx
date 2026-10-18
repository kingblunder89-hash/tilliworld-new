import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Menu, X, UserRound } from 'lucide-react'
import { Logo } from './Brand.jsx'
import CoinBadge from './CoinBadge.jsx'

const links = [
  { to: '/', label: 'Главная', end: true },
  { to: '/shop', label: 'Каталог' },
  { to: '/privileges', label: 'Привилегии' },
  { to: '/reviews', label: 'Отзывы' },
  { to: '/wheel', label: 'Колесо удачи' },
]

const navClass = ({ isActive }) =>
  `rounded-block px-3 py-2 text-[0.9375rem] font-medium transition-colors ${
    isActive ? 'bg-accent-500/15 text-white ring-1 ring-inset ring-accent-400/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
  }`

const accountClass = ({ isActive }) =>
  `inline-flex min-h-11 items-center gap-2 rounded-block border px-3.5 text-[0.9375rem] font-semibold transition-colors ${
    isActive ? 'border-accent-400/40 bg-accent-500/15 text-white' : 'border-white/12 bg-white/[0.03] text-slate-100 hover:bg-white/[0.07]'
  }`

export default function Header() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Основная навигация">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>{l.label}</NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <CoinBadge />
          <NavLink to="/account" className={(s) => `${accountClass(s)} hidden lg:inline-flex`}>
            <UserRound className="size-4" aria-hidden="true" /> Аккаунт
          </NavLink>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-block border border-white/12 bg-white/[0.03] text-white transition-colors hover:bg-white/[0.07] lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-menu" className="animate-menu absolute inset-x-0 top-full border-b border-white/[0.08] bg-ink-900/95 px-4 pb-4 pt-3 shadow-lift backdrop-blur-xl lg:hidden" aria-label="Мобильная навигация">
          <div className="mx-auto flex max-w-6xl flex-col gap-1">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={(s) => `${navClass(s)} flex min-h-11 items-center`}>{l.label}</NavLink>
            ))}
            <NavLink to="/account" className={(s) => `${accountClass(s)} mt-2 justify-center`}>
              <UserRound className="size-4" aria-hidden="true" /> Аккаунт
            </NavLink>
          </div>
        </nav>
      )}
    </header>
  )
}
