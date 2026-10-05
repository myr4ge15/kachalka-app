// login-meta: выборка по префиксу и удаление (v6.12.0, учетки устройства для пикера).
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { setLoginMeta, getLoginMeta, listLoginMeta, deleteLoginMeta } from './local.js'

describe('login-meta', () => {
  it('listLoginMeta берет только ключи с префиксом, deleteLoginMeta удаляет один', async () => {
    await setLoginMeta('pin_a', { name: 'Аня' })
    await setLoginMeta('pin_b', { name: 'Борис' })
    await setLoginMeta('sig_login_users', 'x')
    const keys = (await listLoginMeta('pin_')).map((r) => r.key).sort()
    expect(keys).toEqual(['pin_a', 'pin_b'])
    await deleteLoginMeta('pin_a')
    expect(await getLoginMeta('pin_a')).toBeUndefined()
    expect((await listLoginMeta('pin_')).map((r) => r.value)).toEqual([{ name: 'Борис' }])
    expect(await getLoginMeta('sig_login_users')).toBe('x')
  })
})
