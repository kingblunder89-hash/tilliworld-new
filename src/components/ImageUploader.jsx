import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { uploadProductImage } from '../services/shop.js'
import { useToast } from './toastContext.js'

// Управляет полем image_url: загрузка файла в Supabase Storage, ввод внешней https-ссылки или удаление.
export default function ImageUploader({ value, onChange }) {
  const toast = useToast()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // позволяет выбрать тот же файл повторно
    if (!file) return
    setBusy(true)
    try {
      onChange(await uploadProductImage(file))
      toast.success('Изображение загружено. Нажмите «Сохранить», чтобы применить.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <span className="label">Изображение</span>
      <div className="flex flex-wrap items-start gap-4">
        <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-block border border-white/10 bg-ink-900">
          {value
            ? <img src={value} alt="Предпросмотр изображения" className="size-full object-cover" />
            : <ImagePlus className="size-8 text-slate-600" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} aria-label="Выбрать файл изображения" />
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="size-4" aria-hidden="true" />}
              {busy ? 'Загрузка…' : 'Загрузить файл'}
            </button>
            {value && (
              <button type="button" className="btn-danger" disabled={busy} onClick={() => onChange('')}>
                <Trash2 className="size-4" aria-hidden="true" /> Убрать
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">PNG, JPEG или WebP, до 2 МБ. Либо вставьте https-ссылку ниже.</p>
          <input
            type="url"
            className="input"
            placeholder="https://…"
            aria-label="URL изображения (https)"
            maxLength={500}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
