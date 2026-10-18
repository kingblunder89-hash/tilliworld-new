import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import Dialog from './Dialog.jsx'
import { safeGet, safeSet } from '../lib/storage.js'
import { createOrder } from '../services/shop.js'
import { isSupabaseConfigured } from '../lib/supabase.js'

const NICK = /^[A-Za-z0-9_]{3,16}$/
const COOLDOWN_MS = 30000

export default function OrderForm({ product, onClose }) {
  const [f, setF] = useState({ nickname: '', quantity: '1', comment: '', website: '' }) // website — honeypot
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState('form') // form | confirm | done
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const [orderNo, setOrderNo] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const validate = () => {
    const e = {}
    if (!NICK.test(f.nickname.trim())) e.nickname = 'Ник: 3–16 символов, латиница, цифры и _.'
    if (!/^\d+$/.test(f.quantity) || +f.quantity < 1 || +f.quantity > 999) e.quantity = 'Целое число от 1 до 999.'
    if (f.comment.length > 500) e.comment = 'Максимум 500 символов.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async () => {
    if (busy) return
    if (f.website) return // бот
    const last = +safeGet('tw_last_order') || 0
    if (Date.now() - last < COOLDOWN_MS) return setFail('Подождите немного перед повторной отправкой.')
    setBusy(true); setFail('')
    try {
      const n = await createOrder({ productId: product.id, nickname: f.nickname.trim(), quantity: +f.quantity, comment: f.comment.trim() })
      safeSet('tw_last_order', String(Date.now()))
      setOrderNo(n); setStep('done')
    } catch (e) { setFail(e.message); setStep('form') } finally { setBusy(false) }
  }

  return (
    <Dialog title="Заявка на предмет" onClose={onClose}>
      <div>
        {step === 'done' ? (
          <div className="mt-6 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="size-7" aria-hidden="true" /></span>
            <p className="mt-3 text-lg font-bold text-white">Заявка сохранена</p>
            <p className="mt-1 text-slate-300">Номер заявки: <b className="text-accent-300">#{orderNo}</b></p>
            <p className="mt-3 text-sm text-slate-400">Это не оплата и не подтверждение выдачи. Статус заявки обработает администратор.</p>
            <button type="button" onClick={onClose} className="btn-primary mt-6">Закрыть</button>
          </div>
        ) : step === 'confirm' ? (
          <div className="mt-4">
            {fail && <p role="alert" className="mb-3 rounded-block bg-red-400/10 p-3 text-sm text-red-300">{fail}</p>}
            <p className="mb-3 text-sm text-slate-400">Проверьте данные перед отправкой:</p>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Предмет</dt><dd className="text-white">{product.name}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Ник</dt><dd className="text-white">{f.nickname.trim()}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Количество</dt><dd className="text-white">{f.quantity}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Комментарий</dt><dd className="max-w-[60%] break-words text-right text-white">{f.comment.trim() || '—'}</dd></div>
            </dl>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setStep('form')} className="btn-ghost flex-1" disabled={busy}>Назад</button>
              <button type="button" onClick={submit} className="btn-primary flex-1" disabled={busy}>{busy ? 'Отправка…' : 'Отправить'}</button>
            </div>
          </div>
        ) : (
          <form className="mt-4 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); if (validate()) setStep('confirm') }}>
            {!isSupabaseConfigured && <p role="alert" className="rounded-block bg-amber-400/10 p-3 text-sm text-amber-200">Демо-режим: заявка не будет сохранена, пока не настроен Supabase.</p>}
            {fail && <p role="alert" className="rounded-block bg-red-400/10 p-3 text-sm text-red-300">{fail}</p>}
            <p className="text-sm text-slate-400">Предмет: <b className="text-white">{product.name}</b>. Пароль от Minecraft не нужен и не запрашивается.</p>
            <div>
              <label htmlFor="nick" className="label">Minecraft-ник</label>
              <input id="nick" className="input" value={f.nickname} onChange={set('nickname')} maxLength={16} autoComplete="off" aria-invalid={!!errors.nickname} />
              {errors.nickname && <p className="mt-1 text-sm text-red-300">{errors.nickname}</p>}
            </div>
            <div>
              <label htmlFor="qty" className="label">Количество</label>
              <input id="qty" className="input" inputMode="numeric" value={f.quantity} onChange={set('quantity')} aria-invalid={!!errors.quantity} />
              {errors.quantity && <p className="mt-1 text-sm text-red-300">{errors.quantity}</p>}
            </div>
            <div>
              <label htmlFor="cm" className="label">Комментарий (необязательно)</label>
              <textarea id="cm" rows={3} className="input py-2" value={f.comment} onChange={set('comment')} maxLength={500} />
              {errors.comment && <p className="mt-1 text-sm text-red-300">{errors.comment}</p>}
            </div>
            <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} name="website" />
            <button type="submit" className="btn-primary w-full" disabled={!isSupabaseConfigured}>Проверить заявку</button>
          </form>
        )}
      </div>
    </Dialog>
  )
}
