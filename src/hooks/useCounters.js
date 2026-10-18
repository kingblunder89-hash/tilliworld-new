import { useCallback, useEffect, useState } from 'react'
import { adminCounters } from '../services/reviews.js'

const EVENT = 'admin-counters-refresh'
// Вызывается после действий модератора, чтобы счётчики в навигации обновились сразу.
export const refreshCounters = () => window.dispatchEvent(new Event(EVENT))

// Счётчики новых отзывов, жалоб и активных мутов (считает сервер). Обновляются раз в минуту и по событию.
export function useCounters() {
  const [counters, setCounters] = useState(null)
  const load = useCallback(() => { adminCounters().then(setCounters).catch(() => setCounters(null)) }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 60000)
    window.addEventListener(EVENT, load)
    return () => { clearInterval(timer); window.removeEventListener(EVENT, load) }
  }, [load])
  return counters
}
