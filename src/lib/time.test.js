import { describe, it, expect } from 'vitest'
import { formatRemaining, isEdited, formatDateTime, durationLabel, MUTE_DURATIONS } from './time.js'

describe('formatRemaining', () => {
  it('null — бессрочно', () => expect(formatRemaining(null)).toBe('бессрочно'))
  it('0 и отрицательные — истёк', () => { expect(formatRemaining(0)).toBe('истёк'); expect(formatRemaining(-5)).toBe('истёк') })
  it('секунды, минуты, часы, дни', () => {
    expect(formatRemaining(45)).toBe('45 с')
    expect(formatRemaining(600)).toBe('10 мин 0 с')
    expect(formatRemaining(3 * 3600 + 120)).toBe('3 ч 2 мин')
    expect(formatRemaining(7 * 86400)).toBe('7 д 0 ч')
  })
})
describe('isEdited', () => {
  it('разница меньше допуска — не изменён', () => expect(isEdited('2026-10-17T10:00:00Z', '2026-10-17T10:00:02Z')).toBe(false))
  it('позже допуска — изменён', () => expect(isEdited('2026-10-17T10:00:00Z', '2026-10-17T10:05:00Z')).toBe(true))
  it('некорректные даты — не изменён', () => expect(isEdited('x', null)).toBe(false))
})
describe('formatDateTime', () => {
  it('некорректное значение даёт прочерк', () => { expect(formatDateTime(null)).toBe('—'); expect(formatDateTime('мусор')).toBe('—') })
  it('корректная дата форматируется', () => expect(formatDateTime('2026-10-17T10:00:00Z')).toMatch(/2026/))
})
describe('сроки мута', () => {
  it('ровно пять допустимых сроков', () => expect(MUTE_DURATIONS.map(([k]) => k)).toEqual(['10m', '1h', '24h', '7d', 'permanent']))
  it('подписи', () => expect(durationLabel('permanent')).toBe('Навсегда'))
})
