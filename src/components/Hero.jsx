import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import CopyIpButton from './CopyIpButton.jsx'
import ServerStatusBadge from './ServerStatusBadge.jsx'
import { VoxelCluster } from './Brand.jsx'
import { SERVER_IP, SERVER_VERSION } from '../config/server.js'

export default function Hero() {
  const hasIp = SERVER_IP.trim().length > 0
  return (
    <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
      <div className="bg-grid absolute inset-0 -z-10" aria-hidden="true" />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:min-h-[32rem] lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
        <div className="animate-rise">
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl">
            Tilliworld — твой мир, твои правила
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
            Minecraft-сервер: классическое выживание, PvP, анархия и полная свобода действий.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/shop" className="btn-primary min-h-12 px-6">
              <Package className="size-5" aria-hidden="true" /> Смотреть каталог
            </Link>
            <CopyIpButton />
          </div>
        </div>

        <aside aria-label="Информация о сервере" className="card relative overflow-hidden p-6">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_center,rgb(139_92_246/0.2),transparent_70%)]" aria-hidden="true" />
          <VoxelCluster className="relative mx-auto h-52 w-auto sm:h-60" />
          <dl className="relative mt-4 divide-y divide-white/[0.08] text-sm">
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-slate-400">Версия</dt>
              <dd className="font-medium text-white">Minecraft {SERVER_VERSION}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-slate-400">Адрес</dt>
              <dd className="min-w-0 break-all text-right font-medium text-white">{hasIp ? SERVER_IP : 'скоро появится'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 pt-3">
              <dt className="text-slate-400">Статус</dt>
              <dd><ServerStatusBadge compact /></dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  )
}
