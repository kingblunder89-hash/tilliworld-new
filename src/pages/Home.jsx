import { Swords, Shield, Skull } from 'lucide-react'
import Hero from '../components/Hero.jsx'
import ProductCard from '../components/ProductCard.jsx'
import { SectionHead } from '../components/PageHeader.jsx'
import { Loading, ErrorBox, Empty, DemoBanner } from '../components/States.jsx'
import { ReviewList } from './Reviews.jsx'
import { useAsync } from '../hooks/useAsync.js'
import { usePurchases } from '../hooks/usePurchases.js'
import { listProducts, listReviews } from '../services/shop.js'

const modes = [
  { icon: Shield, t: 'Survival', d: 'Классическое выживание' },
  { icon: Skull, t: 'Anarchy', d: 'Минимум ограничений' },
  { icon: Swords, t: 'PvP', d: 'Сражения между игроками' },
]

export default function Home() {
  const products = useAsync(listProducts)
  const reviews = useAsync(() => listReviews(3))
  const purchases = usePurchases()
  return (
    <>
      <Hero />
      <section className="mx-auto max-w-6xl px-4 pt-14 sm:px-6" aria-labelledby="modes-title">
        <h2 id="modes-title" className="mb-6 font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">Режимы игры</h2>
        <ul className="card grid divide-y divide-white/[0.08] md:grid-cols-3 md:divide-x md:divide-y-0">
          {modes.map(({ icon: Icon, t, d }) => (
            <li key={t} className="flex items-center gap-4 p-6">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-accent-400/25 bg-accent-500/10 text-accent-300"><Icon className="size-6" aria-hidden="true" /></span>
              <div><p className="font-semibold text-white">{t}</p><p className="mt-0.5 text-sm text-slate-400">{d}</p></div>
            </li>
          ))}
        </ul>
      </section>
      <section className="mx-auto max-w-6xl px-4 pt-14 sm:px-6">
        <SectionHead title="Популярные предметы" to="/shop" linkLabel="Весь каталог" />
        <DemoBanner />
        {products.loading ? <Loading /> : products.error ? <ErrorBox message={products.error} onRetry={products.reload} /> :
          products.data.length === 0 ? <Empty title="Каталог пока пуст" /> :
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{products.data.slice(0, 3).map((p) => <ProductCard key={p.id} product={p} mine={purchases.map.get(p.id)} />)}</div>}
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6">
        <SectionHead title="Отзывы игроков" to="/reviews" linkLabel="Все отзывы" />
        <ReviewList state={reviews} />
      </section>
    </>
  )
}
