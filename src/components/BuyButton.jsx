import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Coins, Clock, Loader2, ShoppingCart } from 'lucide-react'
import Dialog from './Dialog.jsx'
import { useToast } from './toastContext.js'
import { isSupabaseConfigured } from '../lib/supabase.js'
import { usePlayer } from '../hooks/usePlayer.js'
import { useEconomy } from '../hooks/useEconomy.js'
import { usePurchases } from '../hooks/usePurchases.js'
import { purchaseProduct } from '../services/shop.js'
import { refreshEconomy } from '../services/economy.js'
import { formatCoins, formatCountdown, secondsLeft } from '../lib/economy.js'
import { purchaseHint, purchaseRuleText } from '../lib/shop.js'

// Покупка предмета за монеты сайта. Состояния операции: idle → confirm → loading → success | error.
// Защита от двойной отправки: синхронный флаг busyRef (state обновляется асинхронно) + один requestId на попытку (на сервере повтор не списывает монеты).
export default function BuyButton({ product, onStale }) {
  const toast = useToast()
  const token = usePlayer()
  const eco = useEconomy()
  const purchases = usePurchases()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState('confirm') // confirm | loading | success | error
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [, tick] = useState(0)
  const busyRef = useRef(false)
  const requestId = useRef(null)
  const price = Number(product.price_coins)

  const mine = purchases.map.get(product.id)
  const left = mine?.next_at ? secondsLeft(mine.next_at, purchases.offset) : 0
  // раз в секунду обновляем обратный отсчёт паузы; по окончании просим сервер пересчитать
  useEffect(() => {
    if (!left) return undefined
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [left])
  useEffect(() => { if (mine?.next_at && left === 0) purchases.reload() }, [mine?.next_at, left]) // eslint-disable-line react-hooks/exhaustive-deps

  const balance = eco.data ? Number(eco.data.balance) : null
  const hint = purchaseHint(product, mine, { balance, secondsToNext: left })
  const rule = purchaseRuleText(product)

  const start = () => {
    requestId.current = requestId.current ?? crypto.randomUUID() // ключ сохраняется до успеха: повтор после обрыва связи не создаст вторую покупку
    setError(null); setPhase('confirm'); setOpen(true)
  }
  const close = () => { if (busyRef.current) return; setOpen(false) }

  const confirm = async () => {
    if (busyRef.current) return // двойной клик / повторное нажатие Enter
    busyRef.current = true
    setPhase('loading'); setError(null)
    try {
      const r = await purchaseProduct({ productId: product.id, requestId: requestId.current, expectedPrice: price })
      requestId.current = null // успех: следующая покупка получит новый ключ
      setResult(r); setPhase('success')
      refreshEconomy() // баланс в шапке, история операций и правила — без перезагрузки страницы
    } catch (e) {
      setError(e); setPhase('error')
      if (e.code !== 'network') requestId.current = null // сервер ответил отказом — заказ не создан, новая попытка получит новый ключ
      if (e.code === 'price_changed' || e.code === 'product_unavailable' || e.code === 'not_for_sale') {
        // данные товара на странице устарели: закрываем окно, объясняем причину и перечитываем товар
        setOpen(false); toast.error(e.message); onStale?.()
      }
      if (e.code === 'price_changed' || e.code === 'insufficient_funds' || e.code === 'already_purchased' || e.code === 'purchase_limit' || e.code === 'purchase_cooldown') refreshEconomy()
    } finally { busyRef.current = false }
  }

  if (!isSupabaseConfigured) return <p className="notice-warn mt-6">Демо-режим: покупка недоступна, пока не настроен Supabase.</p>

  return (
    <div className="mt-6 space-y-3">
      <p className="flex items-center gap-2.5 text-3xl font-bold tabular-nums text-amber-200"><Coins className="size-6" aria-hidden="true" /> {formatCoins(price)} <span className="text-sm font-medium text-slate-400">монет</span></p>
      {rule && <p className="text-sm text-slate-400">{rule}</p>}

      {!token ? (
        <p className="text-slate-300"><Link to="/account" className="btn-primary">Войти, чтобы купить</Link></p>
      ) : (
        <>
          <button type="button" className="btn-primary min-h-12 px-6" onClick={start} disabled={!hint.canBuy || eco.loading}>
            <ShoppingCart className="size-5" aria-hidden="true" /> {hint.reason === 'owned' ? 'Уже куплено' : 'Купить'}
          </button>
          <div aria-live="polite" className="text-sm">
            {hint.reason === 'funds' && <p className="text-red-300">Недостаточно средств: нужно {formatCoins(price)}, на балансе {formatCoins(balance)}. <Link to="/wheel" className="underline">Колесо удачи</Link></p>}
            {hint.reason === 'cooldown' && <p className="flex items-center gap-2 text-slate-300"><Clock className="size-4" aria-hidden="true" /> Повторная покупка через <b className="tabular-nums text-white">{formatCountdown(left)}</b></p>}
            {hint.reason === 'owned' && <p className="text-slate-300">Этот предмет можно купить только один раз.</p>}
            {hint.reason === 'limit' && <p className="text-slate-300">Достигнут лимит покупок этого предмета.</p>}
            {hint.reason === 'unavailable' && <p className="text-slate-300">Сейчас недоступно.</p>}
          </div>
        </>
      )}

      {open && (
        <Dialog title={phase === 'success' ? 'Заказ оформлен' : 'Покупка предмета'} onClose={close}>
          {phase === 'success' && result ? (
            <div className="mt-2 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="size-7" aria-hidden="true" /></span>
              <p className="mt-3 text-lg font-bold text-white">Монеты списаны, заказ #{result.order_number} создан</p>
              <p className="mt-1 text-slate-300">{result.product_name} — {formatCoins(result.price)} монет. Баланс: <b className="text-amber-200">{formatCoins(result.balance)}</b></p>
              {result.duplicate && <p className="mt-2 text-sm text-slate-400">Этот заказ уже был оформлен ранее, повторного списания не было.</p>}
              <p className="notice-warn mt-4 text-left">Предмет пока не выдан. Администратор выдаёт предметы вручную; когда заказ будет выполнен, его статус изменится в разделе «Аккаунт».</p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <Link to="/account" className="btn-ghost" onClick={() => setOpen(false)}>Мои покупки</Link>
                <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Закрыть</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <dl className="space-y-2.5 rounded-xl border border-white/[0.08] bg-ink-900 p-4 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-slate-400">Предмет</dt><dd className="text-right text-white">{product.name}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-400">Цена</dt><dd className="font-bold text-amber-200">{formatCoins(price)} монет</dd></div>
                {balance != null && <div className="flex justify-between gap-4"><dt className="text-slate-400">Баланс после покупки</dt><dd className="text-white">{formatCoins(Math.max(0, balance - price))}</dd></div>}
              </dl>
              <p className="text-xs text-slate-400">Монеты действуют только на сайте. Выдача предмета в игре выполняется администратором вручную, поэтому сразу после покупки предмета в инвентаре не будет.</p>
              {phase === 'error' && error && (
                <div role="alert" className="rounded-block border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                  <p className="font-bold">{error.message}</p>
                  {error.code === 'purchase_cooldown' && error.detail && <p className="mt-1 text-red-200/80">Следующая покупка возможна после {new Date(error.detail).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}.</p>}
                  {error.code === 'insufficient_funds' && <p className="mt-1 text-red-200/80">Монеты можно выиграть в <Link to="/wheel" className="underline" onClick={() => setOpen(false)}>колесе удачи</Link>.</p>}
                </div>)}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={close} disabled={phase === 'loading'}>{phase === 'error' ? 'Закрыть' : 'Отмена'}</button>
                {error?.code !== 'insufficient_funds' && error?.code !== 'already_purchased' && error?.code !== 'purchase_limit' && error?.code !== 'not_authenticated' && (
                  <button type="button" className="btn-primary" onClick={confirm} disabled={phase === 'loading'}>
                    {phase === 'loading' ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Оформляем…</> : phase === 'error' ? 'Повторить' : `Купить за ${formatCoins(price)}`}
                  </button>)}
              </div>
            </div>
          )}
        </Dialog>
      )}
    </div>
  )
}
