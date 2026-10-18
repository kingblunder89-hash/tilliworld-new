import { rpc, rows } from './reviews.js'

// Экономика сайта: все изменения баланса выполняет база (функции 009_economy.sql); клиент только читает и просит выполнить действие.
export const economyMe = () => rpc('economy_me')
export const wheelSpin = () => rpc('wheel_spin')
export const myTransactions = ({ limit = 20, offset = 0 } = {}) => rows('my_transactions', { p_limit: limit, p_offset: offset })
export const mySpins = (limit = 10) => rows('my_spins', { p_limit: limit })

const EVENT = 'economy-refresh'
export const refreshEconomy = () => window.dispatchEvent(new Event(EVENT))
export const onEconomyRefresh = (fn) => { window.addEventListener(EVENT, fn); return () => window.removeEventListener(EVENT, fn) }

export const adminEconomyPlayers = ({ query = '', limit = 20, offset = 0 } = {}) => rows('admin_economy_players', { p_query: query || null, p_limit: limit, p_offset: offset })
export const adminAdjustBalance = (player, amount, reason) => rpc('admin_adjust_balance', { p_player: player, p_amount: amount, p_reason: reason })
export const adminEconomyTransactions = ({ player = null, query = '', limit = 30, offset = 0 } = {}) =>
  rows('admin_economy_transactions', { p_player: player, p_query: query || null, p_limit: limit, p_offset: offset })
export const adminWheelConfig = () => rpc('admin_wheel_config')
export const adminSetWheelEnabled = (enabled) => rpc('admin_set_wheel_enabled', { p_enabled: enabled })
export const adminSetWheelPrizes = (prizes) => rpc('admin_set_wheel_prizes', { p_prizes: prizes })
export const adminWheelSpins = ({ query = '', limit = 30, offset = 0 } = {}) => rows('admin_wheel_spins', { p_query: query || null, p_limit: limit, p_offset: offset })
export const adminWheelStats = () => rpc('admin_wheel_stats')
