import { Link } from 'react-router-dom'
import { SERVER_NAME, SERVER_VERSION } from '../config/server.js'
import { Logo } from './Brand.jsx'
import ServerStatusBadge from './ServerStatusBadge.jsx'

const links = [
  ['/shop', 'Каталог'],
  ['/privileges', 'Привилегии'],
  ['/reviews', 'Отзывы'],
  ['/wheel', 'Колесо удачи'],
  ['/account', 'Аккаунт'],
]

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.08] bg-ink-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-sm leading-relaxed text-slate-400">{SERVER_NAME} — Minecraft {SERVER_VERSION}. Заявки не являются оплатой.</p>
          <div className="mt-4"><ServerStatusBadge compact /></div>
        </div>
        <nav aria-label="Нижняя навигация">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm md:max-w-xs md:justify-end">
            {links.map(([to, label]) => (
              <li key={to}><Link to={to} className="text-slate-400 transition-colors hover:text-white">{label}</Link></li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  )
}
