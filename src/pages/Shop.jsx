import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import ProductCard from '../components/ProductCard.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { Loading, ErrorBox, Empty, DemoBanner } from '../components/States.jsx'
import { useAsync } from '../hooks/useAsync.js'
import { usePurchases } from '../hooks/usePurchases.js'
import { listProducts } from '../services/shop.js'

export default function Shop() {
  const { data, loading, error, reload } = useAsync(listProducts)
  const purchases = usePurchases()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [sort, setSort] = useState('new')

  const cats = useMemo(() => [...new Set((data ?? []).map((p) => p.category))].sort(), [data])
  const items = useMemo(() => {
    const list = (data ?? []).filter((p) => p.product_type !== 'privilege' && (!cat || p.category === cat) && p.name.toLowerCase().includes(q.trim().toLowerCase()))
    const by = { new: (a, b) => b.created_at.localeCompare(a.created_at), az: (a, b) => a.name.localeCompare(b.name, 'ru'), za: (a, b) => b.name.localeCompare(a.name, 'ru') }
    return list.sort(by[sort])
  }, [data, q, cat, sort])

  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <PageHeader title="Каталог предметов">
        Предметы с ценой покупаются за монеты сайта (их можно выиграть в колесе удачи). Выдачу выполняет администратор вручную. Предметы без цены заказываются заявкой без оплаты.
      </PageHeader>
      <DemoBanner />
      <div className="mb-8 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input className="input pl-10" placeholder="Поиск по названию" aria-label="Поиск по названию" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" aria-label="Категория" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Все категории</option>{cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="input" aria-label="Сортировка" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="new">Сначала новые</option><option value="az">Название А–Я</option><option value="za">Название Я–А</option>
        </select>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> :
        items.length === 0 ? <Empty title={data.length ? 'Ничего не найдено' : 'Каталог пока пуст'} text={data.length ? 'Измените поиск или фильтр.' : 'Предметы скоро появятся.'} /> :
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((p) => <ProductCard key={p.id} product={p} mine={purchases.map.get(p.id)} />)}</div>}
    </section>
  )
}
