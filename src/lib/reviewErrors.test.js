import { describe, it, expect } from 'vitest'
import { reviewErrorMessage, REVIEW_ERRORS, AUTH_STATUS } from './reviewErrors.js'

describe('reviewErrorMessage', () => {
  it('переводит каждый код', () => {
    for (const [code, text] of Object.entries(REVIEW_ERRORS)) expect(reviewErrorMessage({ message: code })).toBe(text)
  })
  it('мут с датой и бессрочный', () => {
    expect(reviewErrorMessage({ message: 'user_muted', details: '2026-10-17T10:00:00Z' })).toMatch(/до .*2026/)
    expect(reviewErrorMessage({ message: 'user_muted', details: 'permanent' })).toMatch(/без срока/)
    expect(reviewErrorMessage({ message: 'user_muted' })).toMatch(/без срока/)
  })
  it('статусы входа и регистрации имеют понятный текст', () => {
    for (const k of ['nick_taken', 'invalid_credentials', 'too_many_attempts']) expect(AUTH_STATUS[k]).toBeTruthy()
  })
  it('ошибка сети', () => expect(reviewErrorMessage({ message: 'TypeError: Failed to fetch' })).toMatch(/соединения/))
  it('permission denied', () => expect(reviewErrorMessage({ message: 'permission denied for table x' })).toMatch(/прав/))
  it('неизвестная ошибка не раскрывает детали', () => {
    const m = reviewErrorMessage({ message: 'relation "reviews" does not exist' })
    expect(m).not.toMatch(/relation|reviews/)
  })
})
