import { useState } from 'react'
import Dialog from './Dialog.jsx'

// Подтверждение опасных действий. children — дополнительные поля (например, причина); onConfirm может бросить ошибку — она покажется в окне.
export default function ConfirmDialog({ title, text, confirmLabel = 'Подтвердить', danger = false, onConfirm, onClose, children }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return // защита от повторной отправки
    setBusy(true); setErr('')
    try { await onConfirm(); onClose() }
    catch (ex) { setErr(ex.message); setBusy(false) }
  }
  return (
    <Dialog title={title} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4">
        {text && <p className="text-slate-300">{text}</p>}
        {children}
        {err && <p role="alert" className="notice-error">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="submit" className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy}>{busy ? 'Выполняется…' : confirmLabel}</button>
        </div>
      </form>
    </Dialog>
  )
}
