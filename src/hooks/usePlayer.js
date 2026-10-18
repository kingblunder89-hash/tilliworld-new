import { useSyncExternalStore } from 'react'
import { getPlayerToken, subscribePlayerToken } from '../lib/playerSession.js'

// Токен вошедшего игрока или null. Это только признак для интерфейса: настоящую проверку делает база.
export function usePlayer() {
  return useSyncExternalStore(subscribePlayerToken, getPlayerToken, () => null)
}
