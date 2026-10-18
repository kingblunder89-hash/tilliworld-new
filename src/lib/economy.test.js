import { describe, it, expect } from 'vitest'
import { bpToPercent, percentToBp, parseAmount, validatePrizeRows, secondsLeft, formatCountdown, targetRotation, formatCoins } from './economy.js'

describe('проценты', () => {
  it('bp -> %', () => { expect(bpToPercent(3500)).toBe('35'); expect(bpToPercent(100)).toBe('1'); expect(bpToPercent(1250)).toBe('12.5'); expect(bpToPercent(1)).toBe('0.01') })
  it('% -> bp', () => {
    expect(percentToBp('35')).toBe(3500); expect(percentToBp('12,5')).toBe(1250); expect(percentToBp('0.01')).toBe(1); expect(percentToBp('100')).toBe(10000)
    for (const bad of ['', 'abc', '0', '100.01', '-5', '1.234', '1e2', '101']) expect(percentToBp(bad)).toBeNull()
  })
})
describe('суммы', () => {
  it('валидные и невалидные', () => {
    expect(parseAmount('250')).toBe(250); expect(parseAmount('-5')).toBeNull(); expect(parseAmount('0')).toBeNull(); expect(parseAmount('1.5')).toBeNull()
    expect(parseAmount('1000000001')).toBeNull(); expect(parseAmount('-300', { signed: true })).toBe(-300); expect(parseAmount('+20', { signed: true })).toBe(20)
    expect(parseAmount('abc')).toBeNull()
  })
})
describe('редактор призов', () => {
  const ok = [['50', '35'], ['100', '25'], ['250', '20'], ['500', '12'], ['1000', '7'], ['2500', '1']].map(([amount, percent]) => ({ amount, percent }))
  it('начальные призы дают ровно 100%', () => { const r = validatePrizeRows(ok); expect(r.error).toBeNull(); expect(r.totalBp).toBe(10000); expect(r.prizes[5]).toEqual({ amount: 2500, chance_bp: 100 }) })
  it('сумма не 100% — ошибка', () => { expect(validatePrizeRows([{ amount: '1', percent: '50' }, { amount: '2', percent: '49.99' }]).error).toMatch(/100%/) })
  it('мало призов', () => { expect(validatePrizeRows([{ amount: '1', percent: '100' }]).error).toMatch(/от 2 до 12/) })
  it('плохая сумма/вероятность', () => { expect(validatePrizeRows([{ amount: '-1', percent: '50' }, { amount: '2', percent: '50' }]).error).toMatch(/Сумма приза/); expect(validatePrizeRows([{ amount: '1', percent: 'x' }, { amount: '2', percent: '50' }]).error).toMatch(/Вероятность/) })
  it('0.1+0.2 не ломает сумму (целые bp)', () => { expect(validatePrizeRows([{ amount: '1', percent: '33.33' }, { amount: '2', percent: '33.33' }, { amount: '3', percent: '33.34' }]).error).toBeNull() })
})
describe('таймер', () => {
  it('с поправкой на серверные часы', () => {
    const now = 1_000_000
    expect(secondsLeft(new Date(now + 90_000).toISOString(), 0, now)).toBe(90)
    expect(secondsLeft(new Date(now + 90_000).toISOString(), 30_000, now)).toBe(60) // часы клиента отстают на 30 с
    expect(secondsLeft(new Date(now - 5000).toISOString(), 0, now)).toBe(0); expect(secondsLeft(null, 0, now)).toBe(0)
  })
  it('формат', () => { expect(formatCountdown(0)).toBe('00:00:00'); expect(formatCountdown(86399)).toBe('23:59:59'); expect(formatCountdown(3661)).toBe('01:01:01') })
})
describe('колесо', () => {
  it('сектор под указателем', () => {
    for (let n = 2; n <= 12; n++) for (let i = 0; i < n; i++) {
      const rot = targetRotation(123.4, i, n)
      expect(rot).toBeGreaterThan(123.4 + 360 * 4)
      const under = (((360 - (rot % 360)) % 360) / (360 / n)) // позиция указателя в долях секторов
      expect(Math.floor(under + 1e-9)).toBe(i)
    }
  })
  it('повторные спины всегда крутят вперёд', () => { let r = 0; for (let i = 0; i < 20; i++) { const n = targetRotation(r, i % 6, 6); expect(n).toBeGreaterThan(r); r = n } })
  it('формат монет', () => { expect(formatCoins(1234567)).toMatch(/1\s?234\s?567/); expect(formatCoins('x')).toBe('0') })
})
