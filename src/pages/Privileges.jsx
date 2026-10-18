import { useMemo, useState } from 'react'
import { Search, ShieldCheck } from 'lucide-react'
import ProductCard from '../components/ProductCard.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { Loading, ErrorBox, Empty, DemoBanner } from '../components/States.jsx'
import { useAsync } from '../hooks/useAsync.js'
import { usePurchases } from '../hooks/usePurchases.js'
import { listProducts } from '../services/shop.js'

export default function Privileges() {
  const { data, loading, error, reload } = useAsync(listProducts)
  const purchases = usePurchases()
  const [q, setQ] = useState('')
  const items = useMemo(() => (data ?? []).filter((p) => p.product_type === 'privilege' &&
    `${p.name} ${p.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [data, q])
  return <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
    <PageHeader title="Привилегии" icon={ShieldCheck}>
      Выберите привилегию и оплатите её монетами сайта. После покупки статус отображается в истории заказов; выдача подтверждается только после фактического выполнения на сервере.
    </PageHeader>
    <DemoBanner />
    <div className="relative mb-8"><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true"/><input className="input pl-10" placeholder="Поиск привилегии" aria-label="Поиск привилегии" value={q} onChange={(e) => setQ(e.target.value)}/></div>
    {loading ? <Loading/> : error ? <ErrorBox message={error} onRetry={reload}/> : items.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((p) => <ProductCard key={p.id} product={p} mine={purchases.map.get(p.id)}/>)}</div> : <Empty title="Привилегий пока нет" text="Администратор может добавить их в панели управления товарами."/>}
  </section>
}
