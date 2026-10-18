import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

// Модальное окно: закрытие по Escape и клику на фон, возврат фокуса, блокировка прокрутки страницы.
export default function Dialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose // onClose обычно приходит новой функцией на каждый рендер: в эффект её не включаем

  useEffect(() => {
    const prevFocus = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeRef.current() }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card animate-pop w-full rounded-3xl p-6 shadow-glow outline-none sm:p-7 ${wide ? 'max-w-xl' : 'max-w-md'}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid size-9 shrink-0 place-items-center rounded-block text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
