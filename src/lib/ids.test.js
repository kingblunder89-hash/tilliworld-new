import { describe, it, expect } from 'vitest'
import { isUuid } from './ids.js'

describe('isUuid', () => {
  it('принимает корректный UUID в любом регистре', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    expect(isUuid('123E4567-E89B-12D3-A456-426614174000')).toBe(true)
  })
  it('отклоняет slug, мусор и не-строки', () => {
    for (const v of ['diamond-sword', 'abc', '', '123e4567-e89b-12d3-a456-42661417400', "x' or 1=1", null, undefined, 42]) expect(isUuid(v)).toBe(false)
  })
})
