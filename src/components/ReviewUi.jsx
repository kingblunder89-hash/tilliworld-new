import { Star, BadgeCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDateTime } from '../lib/time.js'

export function Stars({ value, size = 'size-4' }) {
  const v = Math.round(Number(value) || 0)
  return (
    <span className="inline-flex gap-0.5 text-accent-400" role="img" aria-label={`Оценка ${v} из 5`}>
      {Array.from({ length: 5 }, (_, i) => <Star key={i} className={`${size} ${i < v ? 'fill-current' : 'opacity-25'}`} aria-hidden="true" />)}
    </span>
  )
}

// Значок показывается только при is_verified = true; это поле выдаёт сервер (по таблице minecraft_links), клиент его не вычисляет.
export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-block bg-volt-500/15 px-1.5 py-0.5 text-xs font-bold text-volt-300" title="Владение Minecraft-аккаунтом подтверждено на сервере">
      <BadgeCheck className="size-3.5" aria-hidden="true" /> Подтверждён
    </span>
  )
}

// Время хранится в UTC; показываем локально, а точное значение доступно во всплывающей подсказке.
export function Time({ iso, prefix = '' }) {
  if (!iso) return <span>—</span>
  return <time dateTime={iso} title={`UTC: ${iso}`}>{prefix}{formatDateTime(iso)}</time>
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Страницы">
      <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Предыдущая страница"><ChevronLeft className="size-4" aria-hidden="true" /></button>
      <span className="text-sm text-slate-300" aria-live="polite">Страница {page} из {pages}</span>
      <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Следующая страница"><ChevronRight className="size-4" aria-hidden="true" /></button>
    </nav>
  )
}
