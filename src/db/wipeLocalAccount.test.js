// @vitest-environment jsdom
// П7: после удаления аккаунта на устройстве не остается его следов.
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { loginDb, openUserDb, wipeLocalAccount } from './local.js'

describe('wipeLocalAccount', () => {
  it('стирает персональную базу, ростер, кэш PIN и ключи localStorage с id; чужое — на месте', async () => {
    await openUserDb('u1')
    await loginDb.users.bulkPut([{ id: 'u1', name: 'Вася' }, { id: 'u2', name: 'Маша' }])
    await loginDb.meta.bulkPut([{ key: 'pin_u1', value: { pin_hash: 'h' } }, { key: 'pin_u2', value: { pin_hash: 'h2' } }])
    localStorage.setItem('feed_rail_u1', '1')
    localStorage.setItem('feed_rail_u2', '1')
    await wipeLocalAccount('u1')
    expect(await Dexie.exists('gym_app_u1')).toBe(false)
    expect(await loginDb.users.get('u1')).toBeUndefined()
    expect(await loginDb.users.get('u2')).toBeTruthy()
    expect(await loginDb.meta.get('pin_u1')).toBeUndefined()
    expect(await loginDb.meta.get('pin_u2')).toBeTruthy()
    expect(localStorage.getItem('feed_rail_u1')).toBeNull()
    expect(localStorage.getItem('feed_rail_u2')).toBe('1')
  })
})
