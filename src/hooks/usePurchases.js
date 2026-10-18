import { useCallback, useEffect, useState } from 'react'
import { myPurchases } from '../services/shop.js'
import { onEconomyRefresh } from '../services/economy.js'
import { usePlayer } from './usePlayer.js'

// Покупки вошедшего игрока по товарам (сколько учитывается правилами и когда доступна следующая). Источник истины — база;
// данные нужны только для подсказок в интерфейсе, окончательное решение принимает shop_purchase. Обновляется после покупки и колеса.
export function usePurchases() {
  const token = usePlayer()
  const [state, setState] = useState({ map: new Map(), offset: 0, ready: false })
  const load = useCallback(() => {
    if (!token) return Promise.resolve()
    return myPurchases()
      .then((d) => setState({ map: new Map((d.items ?? []).map((i) => [i.product_id, i])), offset: Date.parse(d.server_now) - Date.now(), ready: true }))
      .catch(() => setState((s) => ({ ...s, ready: true }))) // подсказки необязательны: при ошибке остаётся проверка на сервере
  }, [token])
  useEffect(() => { load(); return onEconomyRefresh(load) }, [load])
  return token ? { ...state, reload: load } : { map: new Map(), offset: 0, ready: true, reload: load }
}
