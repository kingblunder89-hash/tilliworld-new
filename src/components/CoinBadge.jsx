import { Link } from 'react-router-dom'
import { Coins } from 'lucide-react'
import { useEconomy } from '../hooks/useEconomy.js'
import { formatCoins } from '../lib/economy.js'

// Баланс монет в шапке. Показывается только вошедшему игроку; читается из базы, не из localStorage.
export default function CoinBadge() {
  const { data } = useEconomy()
  if (!data) return null
  return (
    <Link
      to="/wheel"
      className="inline-flex min-h-11 items-center gap-2 rounded-block border border-amber-300/25 bg-amber-300/[0.08] px-3.5 text-[0.9375rem] font-semibold tabular-nums text-amber-200 transition-colors hover:border-amber-300/40 hover:bg-amber-300/15"
      aria-label={`Баланс: ${formatCoins(data.balance)} монет`}
    >
      <Coins className="size-4" aria-hidden="true" /> {formatCoins(data.balance)}
    </Link>
  )
}
