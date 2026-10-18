import { useState } from 'react'
import { Copy, Check, Clock } from 'lucide-react'
import { SERVER_IP } from '../config/server.js'

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.className = 'fixed opacity-0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  }
}

export default function CopyIpButton() {
  const [copied, setCopied] = useState(false)
  const hasIp = SERVER_IP.trim().length > 0
  const base = 'btn-ghost min-h-12 px-6'

  if (!hasIp) {
    return (
      <button type="button" disabled className={`${base} text-slate-400`}>
        <Clock className="size-5" aria-hidden="true" /> IP скоро появится
      </button>
    )
  }

  const onClick = async () => {
    if (await copyText(SERVER_IP)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button type="button" onClick={onClick} className={`${base} ${copied ? 'border-emerald-400/40 text-emerald-300' : ''}`}>
      {copied ? <Check className="size-5" aria-hidden="true" /> : <Copy className="size-5" aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'IP скопирован' : 'Скопировать IP'}</span>
    </button>
  )
}
