import { useCallback, useEffect, useState } from 'react'
import { economyMe, onEconomyRefresh } from '../services/economy.js'
import { usePlayer } from './usePlayer.js'

// Баланс и состояние колеса вошедшего игрока (источник истины — база). Обновляется по событию после спина.
export function useEconomy() {
  const token = usePlayer()
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(token), offset: 0 })
  const load = useCallback(() => {
    if (!token) return Promise.resolve()
    return economyMe()
      .then((data) => setState({ data, error: null, loading: false, offset: Date.parse(data.server_now) - Date.now() }))
      .catch((e) => setState((s) => ({ ...s, error: e.message, loading: false })))
  }, [token])
  useEffect(() => { load(); return onEconomyRefresh(load) }, [load])
  return { ...(token ? state : { data: null, error: null, loading: false, offset: 0 }), reload: load }
}
