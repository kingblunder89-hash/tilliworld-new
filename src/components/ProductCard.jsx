import { Link } from 'react-router-dom'
import { Box, Check, Coins } from 'lucide-react'
import { formatCoins } from '../lib/economy.js'

export function ProductImage({ product, className = '' }) {
  return product.image_url ? (
    <img src={product.image_url} alt={product.name} loading="lazy" className={`object-cover ${className}`} />
  ) : (
    <div className={`grid place-items-center bg-ink-700 ${className}`} aria-hidden="true">
      <Box className="size-10 text-accent-300/50" />
    </div>
  )
}

// mine — запись игрока о покупках этого товара (usePurchases): нужна, чтобы отметить «Куплено» у одноразовых предметов.
export default function ProductCard({ product, mine }) {
  const owned = product.purchase_mode === 'one_time' && (Number(mine?.purchases) || 0) >= 1
  const unavailable = !product.is_available
  return (
    <Link to={`/shop/${product.id}`} className="card group flex h-full flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-accent-400/40 hover:shadow-glow">
      <div className="overflow-hidden">
        <ProductImage product={product} className={`aspect-[16/10] w-full transition duration-300 group-hover:scale-[1.03] ${unavailable ? 'opacity-50 grayscale' : ''}`} />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p><span className="chip">{product.category}</span></p>
        <h3 className="mt-3 text-lg font-semibold leading-snug text-white">{product.name}</h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-slate-400">{product.description}</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-sm">
          {product.price_coins != null
            ? <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-amber-200"><Coins className="size-4" aria-hidden="true" /> {formatCoins(product.price_coins)}</span>
            : <span className="text-slate-300">{product.display_price || '—'}</span>}
          {owned
            ? <span className="chip border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><Check className="size-3.5" aria-hidden="true" /> Куплено</span>
            : unavailable && <span className="chip">Недоступно</span>}
        </div>
      </div>
    </Link>
  )
}
