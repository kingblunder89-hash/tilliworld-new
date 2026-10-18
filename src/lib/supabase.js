import { createClient } from '@supabase/supabase-js'
import { getPlayerToken } from './playerSession.js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && key)
// К каждому запросу добавляется токен игрока (если он вошёл). Администраторы входят отдельно, через Supabase Auth.
const playerFetch = (input, init = {}) => {
  const token = getPlayerToken()
  if (!token) return fetch(input, init)
  const headers = new Headers(init.headers)
  headers.set('x-player-token', token)
  return fetch(input, { ...init, headers })
}
export const supabase = isSupabaseConfigured ? createClient(url, key, { global: { fetch: playerFetch } }) : null
