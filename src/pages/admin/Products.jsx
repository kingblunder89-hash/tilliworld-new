import { useState } from 'react'
import { Pencil, Trash2, Eye, EyeOff, PackageCheck, PackageX, Plus } from 'lucide-react'
import { Loading, ErrorBox, Empty } from '../../components/States.jsx'
import { ProductImage } from '../../components/ProductCard.jsx'
import ImageUploader from '../../components/ImageUploader.jsx'
import { useToast } from '../../components/toastContext.js'
import { useAsync } from '../../hooks/useAsync.js'
import { listAllProducts, saveProduct, deleteProduct, removeProductImage } from '../../services/shop.js'
import { PURCHASE_MODES } from '../../lib/shop.js'
import { formatCoins } from '../../lib/economy.js'

const blank = { name: '', slug: '', description: '', category: 'Разное', image_url: '', display_price: '', is_published: false, is_available: true, price_coins: '', purchase_mode: 'repeatable', max_per_player: '', repurchase_cooldown_hours: '', product_type: 'item', grant_key: '', duration_days: '' }
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `item-${Date.now().toString(36)}`

export default function Products() {
  const { data, loading, error, reload } = useAsync(listAllProducts)
  const toast = useToast()
  const [form, setForm] = useState(null)
  const [initialImage, setInitialImage] = useState(null) // изображение на момент открытия формы
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const open = (p) => { setForm({ ...p, price_coins: p.price_coins ?? '', max_per_player: p.max_per_player ?? '', repurchase_cooldown_hours: p.repurchase_cooldown_hours ?? '', product_type: p.product_type ?? 'item', grant_key: p.grant_key ?? '', duration_days: p.duration_days ?? '' }); setInitialImage(p.image_url || null) }
  const close = () => setForm(null)

  const save = async (e) => {
    e.preventDefault()
    if (saving) return
    const slug = (form.slug || slugify(form.name)).trim()
    if (!SLUG.test(slug)) return toast.error('Slug: только строчные латинские буквы, цифры и дефис.')
    setSaving(true)
    try {
      const saved = await saveProduct({ ...form, slug })
      // если изображение заменили или убрали — удаляем прежний файл из Storage
      if (initialImage && initialImage !== saved.image_url) await removeProductImage(initialImage)
      toast.success(form.id ? 'Предмет обновлён' : 'Предмет добавлен')
      close(); reload()
    } catch (err) {
      toast.error(/duplicate key|slug/i.test(err.message) ? 'Предмет с таким slug уже существует.' : err.message)
    } finally { setSaving(false) }
  }

  // быстрые переключатели прямо в списке
  const toggle = async (p, field, label) => {
    try {
      await saveProduct({ ...p, [field]: !p[field] })
      toast.success(`«${p.name}»: ${label(!p[field])}`)
      reload()
    } catch (err) { toast.error(err.message) }
  }

  const remove = async (p) => {
    if (!window.confirm(`Скрыть «${p.name}»? История покупок сохранится.`)) return
    try {
      await deleteProduct(p.id)
      toast.success('Товар скрыт; история покупок сохранена'); reload()
    } catch (err) { toast.error(err.message) }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">Предметы</h1>
        <button type="button" className="btn-primary" onClick={() => open(blank)}><Plus className="size-4" aria-hidden="true" /> Добавить</button>
      </div>

      {form && (
        <form onSubmit={save} className="card mb-6 grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="text-lg font-bold text-white sm:col-span-2">{form.id ? 'Редактирование предмета' : 'Новый предмет'}</h2>
          <div><label className="label" htmlFor="pn">Название</label><input id="pn" required maxLength={120} className="input" value={form.name} onChange={set('name')} /></div>
          <div><label className="label" htmlFor="ps">Slug (латиница)</label><input id="ps" maxLength={140} className="input" value={form.slug} onChange={set('slug')} placeholder="создаётся автоматически" /></div>
          <div><label className="label" htmlFor="pc">Категория</label><input id="pc" maxLength={60} className="input" value={form.category} onChange={set('category')} /></div>
          <div>
            <label className="label" htmlFor="pp">Информационная стоимость</label>
            <input id="pp" maxLength={60} className="input" value={form.display_price ?? ''} onChange={set('display_price')} placeholder="Например: 5 алмазов" />
            <p className="mt-1 text-xs text-slate-500">Условная стоимость для информации (не списывается). Для продажи за монеты задайте цену ниже.</p>
          </div>
          <fieldset className="grid gap-4 rounded-block border border-white/10 p-4 sm:col-span-2 sm:grid-cols-2">
            <div><label className="label" htmlFor="ptype">Тип товара</label><select id="ptype" className="input" value={form.product_type ?? 'item'} onChange={set('product_type')}><option value="item">Предмет</option><option value="privilege">Привилегия</option></select></div>
            <div><label className="label" htmlFor="pgrant">Ключ выдачи (настройка интеграции)</label><input id="pgrant" className="input" value={form.grant_key ?? ''} onChange={set('grant_key')} placeholder="например: vip" /><p className="mt-1 text-xs text-slate-500">Не запускает команду автоматически: нужен серверный обработчик выдачи.</p></div>
            <div><label className="label" htmlFor="pduration">Срок привилегии, дней</label><input id="pduration" type="number" min="1" max="3650" className="input" value={form.duration_days ?? ''} onChange={set('duration_days')} placeholder="Пусто — постоянная" /></div>
            <legend className="px-2 text-sm font-bold text-amber-200">Продажа за монеты сайта</legend>
            <div>
              <label className="label" htmlFor="pcoins">Цена в монетах</label>
              <input id="pcoins" inputMode="numeric" className="input" value={form.price_coins} onChange={set('price_coins')} placeholder="Пусто — не продаётся, только заявка" />
              <p className="mt-1 text-xs text-slate-500">Цена проверяется и списывается базой. Изменение цены не затрагивает уже оформленные заказы.</p>
            </div>
            <div>
              <label className="label" htmlFor="pmode">Тип товара</label>
              <select id="pmode" className="input" value={form.purchase_mode} onChange={set('purchase_mode')}>
                {Object.entries(PURCHASE_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="pmax">Лимит покупок на игрока</label>
              <input id="pmax" inputMode="numeric" className="input" value={form.max_per_player} onChange={set('max_per_player')} disabled={form.purchase_mode === 'one_time'} placeholder="Пусто — без лимита" />
            </div>
            <div>
              <label className="label" htmlFor="pcd">Пауза между покупками, часов</label>
              <input id="pcd" inputMode="numeric" className="input" value={form.repurchase_cooldown_hours} onChange={set('repurchase_cooldown_hours')} disabled={form.purchase_mode === 'one_time'} placeholder="Пусто — без паузы" />
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2">Отклонённые заказы (монеты возвращены) в лимит не засчитываются. Выдачу предметов выполняет администратор вручную.</p>
          </fieldset>
          <div className="sm:col-span-2"><ImageUploader value={form.image_url ?? ''} onChange={(url) => setForm((f) => ({ ...f, image_url: url }))} /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="pd">Описание</label><textarea id="pd" rows={4} maxLength={4000} className="input py-2" value={form.description} onChange={set('description')} /></div>
          <label className="flex items-center gap-2"><input type="checkbox" className="size-5" checked={form.is_published} onChange={set('is_published')} /> Опубликован (виден в каталоге)</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="size-5" checked={form.is_available} onChange={set('is_available')} /> Доступен для покупки и заявок</label>
          <div className="flex gap-3 sm:col-span-2">
            <button className="btn-primary" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
            <button type="button" className="btn-ghost" onClick={close} disabled={saving}>Отмена</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : data.length === 0 ? <Empty title="Предметов пока нет" text="Добавьте первый предмет." /> : (
        <ul className="card divide-y divide-white/10">
          {data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-4 p-4">
              <ProductImage product={p} className="size-14 shrink-0 rounded-block" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-white">{p.name}</p>
                <p className="text-sm text-slate-400">
                  {p.product_type === 'privilege' ? <b className="text-volt-300">Привилегия</b> : null} {p.price_coins != null ? <b className="text-amber-200">{formatCoins(p.price_coins)} мон.</b> : 'без цены'} · {p.category} · <span className={p.is_published ? 'text-accent-300' : 'text-amber-300'}>{p.is_published ? 'опубликован' : 'скрыт'}</span> · {p.is_available ? 'доступен' : 'недоступен'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-ghost px-3!" onClick={() => toggle(p, 'is_published', (v) => (v ? 'опубликован' : 'скрыт'))}
                  aria-label={p.is_published ? `Скрыть «${p.name}»` : `Опубликовать «${p.name}»`} title={p.is_published ? 'Скрыть' : 'Опубликовать'}>
                  {p.is_published ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
                <button type="button" className="btn-ghost px-3!" onClick={() => toggle(p, 'is_available', (v) => (v ? 'доступен для заявок' : 'недоступен для заявок'))}
                  aria-label={p.is_available ? `Сделать «${p.name}» недоступным` : `Сделать «${p.name}» доступным`} title={p.is_available ? 'Сделать недоступным' : 'Сделать доступным'}>
                  {p.is_available ? <PackageX className="size-4" aria-hidden="true" /> : <PackageCheck className="size-4" aria-hidden="true" />}
                </button>
                <button type="button" className="btn-ghost" onClick={() => open(p)}><Pencil className="size-4" aria-hidden="true" /> Изменить</button>
                <button type="button" className="btn-danger" onClick={() => remove(p)} aria-label={`Удалить «${p.name}»`}><Trash2 className="size-4" aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
