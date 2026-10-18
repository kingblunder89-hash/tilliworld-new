import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { ToastContext } from './toastContext.js'

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((type, text) => {
    const id = crypto.randomUUID()
    setItems((list) => [...list.slice(-3), { id, type, text }])
    timers.current.set(id, setTimeout(() => dismiss(id), type === 'error' ? 7000 : 4000))
  }, [dismiss])

  useEffect(() => {
    const t = timers.current
    return () => t.forEach(clearTimeout)
  }, [])

  const api = useRef({
    success: (text) => push('success', text),
    error: (text) => push('error', text),
  })
  api.current.success = (text) => push('success', text)
  api.current.error = (text) => push('error', text)

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[90] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-md animate-pop items-start gap-3 rounded-xl border bg-ink-700 p-3.5 text-sm shadow-lift ${
              t.type === 'error' ? 'border-red-400/40 text-red-200' : 'border-emerald-400/40 text-emerald-100'
            }`}
          >
            {t.type === 'error'
              ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden="true" />
              : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />}
            <span className="flex-1 break-words">{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Закрыть уведомление" className="rounded text-slate-400 transition-colors hover:text-white">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

