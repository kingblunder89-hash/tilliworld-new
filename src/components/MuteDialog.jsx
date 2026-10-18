import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import { useToast } from './toastContext.js'
import { MUTE_DURATIONS } from '../lib/time.js'
import { adminIssueMute } from '../services/reviews.js'
import { refreshCounters } from '../hooks/useCounters.js'

// Срок и причина проверяются на сервере; время окончания считает база, клиент его не передаёт.
export default function MuteDialog({ target, onClose, onDone }) {
  const toast = useToast()
  const [duration, setDuration] = useState('1h')
  const [reason, setReason] = useState('')
  return (
    <ConfirmDialog title={`Мут: ${target.nickname || 'игрок'}`} confirmLabel="Выдать мут" danger onClose={onClose}
      text="Игрок не сможет публиковать и редактировать отзывы. Мут действует на аккаунт и на подтверждённый Minecraft-аккаунт. Наказание в Minecraft это не затрагивает."
      onConfirm={async () => {
        if (reason.trim().length < 3) throw new Error('Укажите причину (минимум 3 символа).')
        await adminIssueMute({ userId: target.userId, duration, reason: reason.trim() })
        toast.success('Мут выдан'); refreshCounters(); onDone?.()
      }}>
      <div><label className="label" htmlFor="mute-duration">Срок</label>
        <select id="mute-duration" className="input" value={duration} onChange={(e) => setDuration(e.target.value)}>
          {MUTE_DURATIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      <div><label className="label" htmlFor="mute-reason">Причина (обязательно)</label>
        <textarea id="mute-reason" className="input min-h-20 py-2" maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    </ConfirmDialog>
  )
}
