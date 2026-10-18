import { describe, it, expect } from 'vitest'
import { adminHas, adminFull } from './perms.js'

const user = (meta) => ({ app_metadata: meta })
describe('adminHas', () => {
  it('не администратор — нет прав', () => expect(adminHas(user({}), 'mutes')).toBe(false))
  it('role только в user_metadata не считается', () => expect(adminHas({ user_metadata: { role: 'admin' }, app_metadata: {} }, 'mutes')).toBe(false))
  it('без permissions — полный доступ', () => expect(adminHas(user({ role: 'admin' }), 'audit')).toBe(true))
  it('ограниченный список', () => {
    const u = user({ role: 'admin', permissions: ['moderate'] })
    expect(adminHas(u, 'moderate')).toBe(true)
    expect(adminHas(u, 'mutes')).toBe(false)
    expect(adminFull(u)).toBe(false)
  })
  it('all — всё', () => expect(adminFull(user({ role: 'admin', permissions: ['all'] }))).toBe(true))
  it('нет пользователя', () => expect(adminHas(null, 'mutes')).toBe(false))
})
