import { describe, it, expect } from 'vitest'
import { orderErrorMessage, ORDER_ERRORS } from './orderErrors.js'

describe('orderErrorMessage', () => {
  it('переводит каждый код ошибки create_order', () => {
    for (const [code, text] of Object.entries(ORDER_ERRORS)) expect(orderErrorMessage({ message: `${code}` })).toBe(text)
  })
  it('находит код внутри длинного сообщения Postgres', () => {
    expect(orderErrorMessage({ message: 'P0001: product_unavailable' })).toBe(ORDER_ERRORS.product_unavailable)
  })
  it('сообщает о проблемах сети', () => {
    expect(orderErrorMessage({ message: 'TypeError: Failed to fetch' })).toMatch(/соединения/)
  })
  it('на неизвестную ошибку не раскрывает технические детали', () => {
    const m = orderErrorMessage({ message: 'relation "orders" does not exist' })
    expect(m).toBe('Не удалось сохранить заявку. Попробуйте позже.')
    expect(orderErrorMessage(null)).toBe(m)
  })
})
