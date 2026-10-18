import { useEffect } from 'react'
import { useAsync } from '../hooks/useAsync.js'
import { getServerStatus } from '../services/shop.js'

const REFRESH_MS = 60_000

const VIEW = {
  online: { label: 'Сервер включён', dot: 'bg-emerald-400', box: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' },
  offline: { label: 'Сервер выключен', dot: 'bg-red-400', box: 'border-red-400/30 bg-red-400/10 text-red-300' },
  unknown: { label: 'Статус сервера не указан', dot: 'bg-slate-500', box: 'border-white/12 bg-white/[0.04] text-slate-300' },
}

// Статус показывается так, как его выставил администратор. Автоматически сервер не опрашивается.
export default function ServerStatusBadge({ compact = false }) {
  const { data, error, reload } = useAsync(getServerStatus)

  useEffect(() => {
    const id = setInterval(reload, REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [reload])

  const key = error || !data ? 'unknown' : data.is_online ? 'online' : 'offline'
  const v = VIEW[key]
  const updated = data?.updated_at && !error
    ? new Date(data.updated_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : null

  return (
    <p
      role="status"
      title={updated ? `Статус указал администратор. Обновлён: ${updated}` : 'Статус указывает администратор'}
      className={`inline-flex items-center gap-2 rounded-full border font-medium ${v.box} ${compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${v.dot} ${key === 'online' ? 'motion-safe:animate-pulse-soft' : ''}`} aria-hidden="true" />
      {v.label}
      {!compact && updated && <span className="hidden text-xs font-normal opacity-70 sm:inline">обновлено {updated}</span>}
    </p>
  )
}
