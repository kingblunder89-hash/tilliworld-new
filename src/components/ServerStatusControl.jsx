import { useState } from 'react'
import { Power } from 'lucide-react'
import { Loading, ErrorBox } from './States.jsx'
import { useToast } from './toastContext.js'
import { useAsync } from '../hooks/useAsync.js'
import { getServerStatus, setServerStatus } from '../services/shop.js'

// Переключатель статуса сервера для админ-панели. Посетители видят значение в ServerStatusBadge.
export default function ServerStatusControl() {
  const { data, loading, error, reload } = useAsync(getServerStatus)
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox message={`Не удалось загрузить статус сервера: ${error}. Применена ли миграция 003?`} onRetry={reload} />
  if (!data) return <ErrorBox message="Строка статуса сервера не найдена. Выполните миграцию 003_server_status.sql." onRetry={reload} />

  const online = data.is_online
  const toggle = async () => {
    setBusy(true)
    try {
      await setServerStatus(!online)
      toast.success(!online ? 'Статус изменён: сервер включён' : 'Статус изменён: сервер выключен')
      reload()
    } catch (e) {
      toast.error(e.message)
    } finally { setBusy(false) }
  }

  return (
    <section className="card flex flex-wrap items-center justify-between gap-4 p-5" aria-labelledby="srv-status-title">
      <div>
        <h2 id="srv-status-title" className="text-lg font-bold text-white">Статус Minecraft-сервера</h2>
        <p className="mt-1 text-sm text-slate-400">
          Сейчас посетители видят: <b className={online ? 'text-emerald-300' : 'text-red-300'}>{online ? 'сервер включён' : 'сервер выключен'}</b>.
          Статус меняется вручную. Сайт сам сервер не проверяет, поэтому переключайте его, когда запускаете или останавливаете сервер.
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={toggle}
        className={online ? 'btn-danger' : 'btn-primary'}
      >
        <Power className="size-4" aria-hidden="true" />
        {busy ? 'Сохранение…' : online ? 'Отметить выключенным' : 'Отметить включённым'}
      </button>
    </section>
  )
}
