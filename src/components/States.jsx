import { Loader2, AlertTriangle, PackageOpen, FlaskConical } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase.js'

export const Loading = ({ text = 'Загрузка…' }) => (
  <div role="status" className="flex items-center justify-center gap-3 py-16 text-slate-400">
    <Loader2 className="size-5 animate-spin text-accent-300" aria-hidden="true" /> {text}
  </div>
)
export const ErrorBox = ({ message, onRetry }) => (
  <div role="alert" className="card mx-auto max-w-xl border-red-400/25 p-6 text-center">
    <span className="mx-auto grid size-12 place-items-center rounded-xl border border-red-400/25 bg-red-400/10 text-red-300"><AlertTriangle className="size-6" aria-hidden="true" /></span>
    <p className="mt-4 text-slate-200">{message}</p>
    {onRetry && <button type="button" onClick={onRetry} className="btn-ghost mt-5">Повторить</button>}
  </div>
)
export const Empty = ({ title, text }) => (
  <div className="card mx-auto max-w-xl p-8 text-center">
    <span className="mx-auto grid size-12 place-items-center rounded-xl border border-accent-400/25 bg-accent-500/10 text-accent-300"><PackageOpen className="size-6" aria-hidden="true" /></span>
    <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
    {text && <p className="mt-1.5 text-slate-400">{text}</p>}
  </div>
)
export const DemoBanner = () =>
  isSupabaseConfigured ? null : (
    <div className="notice-warn mb-6">
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      Демо-режим: Supabase не настроен, показаны тестовые предметы, заявки не сохраняются.
    </div>
  )
