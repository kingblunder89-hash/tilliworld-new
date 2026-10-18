import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import { ProductImage } from '../components/ProductCard.jsx'
import OrderForm from '../components/OrderForm.jsx'
import BuyButton from '../components/BuyButton.jsx'
import { Loading, ErrorBox, Empty } from '../components/States.jsx'
import { useAsync } from '../hooks/useAsync.js'
import { getProduct } from '../services/shop.js'

export default function Product() {
  const { id } = useParams()
  const { data: p, loading, error, reload } = useAsync(() => getProduct(id), [id])
  const [open, setOpen] = useState(false)

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <Link to="/shop" className="group mb-6 inline-flex items-center gap-2 text-sm font-medium text-accent-300 hover:text-accent-200"><ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" /> Каталог</Link>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !p ? <Empty title="Предмет не найден" text="Возможно, он скрыт или удалён." /> : (
        <div className="grid gap-8 md:grid-cols-2">
          <ProductImage product={p} className="aspect-square w-full rounded-2xl border border-white/[0.08]" />
          <div>
            <p><span className="chip">{p.category}</span></p>
            <h1 className="mt-3 font-display text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">{p.name}</h1>
            <p className="mt-4 whitespace-pre-line leading-relaxed text-slate-300">{p.description || 'Описание пока не добавлено.'}</p>
            {p.price_coins != null ? <BuyButton product={p} onStale={reload} /> : (
              <>
                {p.display_price && <p className="mt-5 text-slate-300">Информационная стоимость: <b className="text-white">{p.display_price}</b> <span className="text-sm text-slate-500">(условная, не платёж)</span></p>}
                <button type="button" className="btn-primary mt-8 min-h-12 px-6" onClick={() => setOpen(true)} disabled={!p.is_available}>
                  <ClipboardList className="size-5" aria-hidden="true" /> {p.is_available ? 'Оставить заявку' : 'Сейчас недоступно'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {open && p && p.price_coins == null && <OrderForm product={p} onClose={() => setOpen(false)} />}
    </section>
  )
}
