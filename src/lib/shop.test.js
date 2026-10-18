import { describe, it, expect } from 'vitest'
import { purchaseError, purchaseHint, purchaseRuleText, orderStatusForPlayer, validateSaleFields, orderAdminError } from './shop.js'

const prod = (o = {}) => ({ is_available: true, price_coins: 100, purchase_mode: 'repeatable', max_per_player: null, repurchase_cooldown_hours: null, ...o })

describe('ошибки покупки', () => {
  it('коды базы -> текст пользователю', () => {
    expect(purchaseError({ message: 'insufficient_funds' })).toMatchObject({ code: 'insufficient_funds', message: 'Недостаточно средств' })
    expect(purchaseError({ message: 'price_changed', details: '250' })).toMatchObject({ code: 'price_changed', detail: '250' })
    expect(purchaseError({ message: 'already_purchased' }).code).toBe('already_purchased')
    expect(purchaseError({ message: 'not_authenticated' }).code).toBe('not_authenticated')
  })
  it('обрыв связи — отдельный код (повтор с тем же ключом безопасен)', () => {
    expect(purchaseError({ message: 'TypeError: Failed to fetch' }).code).toBe('network')
  })
  it('неизвестная ошибка не показывает технических подробностей', () => {
    const e = purchaseError({ message: 'relation "orders" does not exist' })
    expect(e.code).toBe('unknown'); expect(e.message).not.toMatch(/relation/)
  })
})

describe('подсказки интерфейса', () => {
  it('можно купить', () => expect(purchaseHint(prod(), undefined, { balance: 500 }).canBuy).toBe(true))
  it('недостаточно средств', () => expect(purchaseHint(prod(), undefined, { balance: 99 })).toMatchObject({ canBuy: false, reason: 'funds', text: 'Недостаточно средств' }))
  it('баланс ещё не известен — кнопку решает сервер', () => expect(purchaseHint(prod(), undefined, { balance: null }).canBuy).toBe(true))
  it('одноразовый уже куплен', () => expect(purchaseHint(prod({ purchase_mode: 'one_time' }), { purchases: 1 }, { balance: 500 }).reason).toBe('owned'))
  it('лимит', () => {
    expect(purchaseHint(prod({ max_per_player: 3 }), { purchases: 3 }, { balance: 500 }).reason).toBe('limit')
    expect(purchaseHint(prod({ max_per_player: 3 }), { purchases: 2 }, { balance: 500 }).canBuy).toBe(true)
  })
  it('пауза', () => expect(purchaseHint(prod({ repurchase_cooldown_hours: 24 }), { purchases: 1 }, { balance: 500, secondsToNext: 60 }).reason).toBe('cooldown'))
  it('недоступный и непродаваемый', () => {
    expect(purchaseHint(prod({ is_available: false }), undefined, { balance: 500 }).reason).toBe('unavailable')
    expect(purchaseHint(prod({ price_coins: null }), undefined, { balance: 500 }).reason).toBe('not_for_sale')
  })
  it('правила одной строкой', () => {
    expect(purchaseRuleText(prod())).toBeNull()
    expect(purchaseRuleText(prod({ purchase_mode: 'one_time' }))).toBe('Можно купить один раз.')
    expect(purchaseRuleText(prod({ max_per_player: 2, repurchase_cooldown_hours: 12 }))).toBe('Не более 2 шт. на игрока. Повторно — не чаще, чем раз в 12 ч.')
  })
})

describe('статус заказа для игрока', () => {
  it('«выдан» только после отметки администратора', () => {
    expect(orderStatusForPlayer('new', false).label).toMatch(/Ожидает выдачи/)
    expect(orderStatusForPlayer('accepted', false).label).toMatch(/ещё не выдан/)
    expect(orderStatusForPlayer('completed', false).label).toMatch(/Выдан/)
    expect(orderStatusForPlayer('new', false).label).not.toMatch(/^Выдан/)
  })
  it('отклонён с возвратом', () => expect(orderStatusForPlayer('rejected', true).label).toMatch(/монеты возвращены/))
})

describe('поля продажи в админке', () => {
  const ok = (o) => validateSaleFields({ price_coins: '', purchase_mode: 'repeatable', max_per_player: '', repurchase_cooldown_hours: '', ...o })
  it('пустая цена — не продаётся', () => expect(ok({}).value).toEqual({ price_coins: null, purchase_mode: 'repeatable', max_per_player: null, repurchase_cooldown_hours: null }))
  it('цена и правила', () => expect(ok({ price_coins: '250', max_per_player: '3', repurchase_cooldown_hours: '24' }).value).toEqual({ price_coins: 250, purchase_mode: 'repeatable', max_per_player: 3, repurchase_cooldown_hours: 24 }))
  it('для одноразового лимит и пауза сбрасываются', () => expect(ok({ price_coins: 10, purchase_mode: 'one_time', max_per_player: '3' }).value).toEqual({ price_coins: 10, purchase_mode: 'one_time', max_per_player: null, repurchase_cooldown_hours: null }))
  it('без цены лимиты не сохраняются', () => expect(ok({ max_per_player: '3' }).value.max_per_player).toBeNull())
  it('невалидные значения', () => {
    for (const bad of ['0', '-5', '1.5', 'abc', '1000000001', '1e3']) expect(ok({ price_coins: bad }).error).toBeTruthy()
    expect(ok({ price_coins: '5', max_per_player: '0' }).error).toBeTruthy()
    expect(ok({ price_coins: '5', repurchase_cooldown_hours: '9000' }).error).toBeTruthy()
    expect(ok({ purchase_mode: 'x' }).error).toBeTruthy()
  })
  it('значения из базы (числа и null) принимаются', () => expect(ok({ price_coins: 500, max_per_player: null }).error).toBeNull())
})

describe('ошибки админских операций над заказами', () => {
  it('коды базы -> понятный текст', () => {
    expect(orderAdminError({ message: 'order_fulfilled' })).toMatch(/уже выдан/)
    expect(orderAdminError({ message: 'order_processing' })).toMatch(/Выдача в процессе/)
    expect(orderAdminError({ message: 'order_refunded' })).toMatch(/уже возвращены/)
    expect(orderAdminError({ message: 'note_required' })).toMatch(/причину/)
    expect(orderAdminError({ message: 'permission denied' })).toBe('permission denied')
  })
  it('нет прав и обрыв связи не выглядят как успех', () => {
    expect(orderAdminError({ message: 'forbidden' })).toMatch(/shop/)
    expect(orderAdminError({ message: 'TypeError: Failed to fetch' })).toMatch(/проверьте статус/)
  })
  it('пустая ошибка даёт общее сообщение', () => {
    expect(orderAdminError({})).toBe('Операция не выполнена.')
  })
})
