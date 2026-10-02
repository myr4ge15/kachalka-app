import { beforeEach, expect, it, vi } from 'vitest'
import { memberInviteApi } from './memberInvites.js'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), hasSession: vi.fn() }))
vi.mock('../db/supabase.js', () => ({ supabase: { rpc: mocks.rpc }, hasSession: mocks.hasSession }))
beforeEach(() => { vi.clearAllMocks(); mocks.hasSession.mockResolvedValue(true) })
it('не создаёт приглашение под чужой сессией', async () => {
  mocks.hasSession.mockResolvedValue(false)
  await expect(memberInviteApi('me').create()).rejects.toThrow('свою учётную')
  expect(mocks.hasSession).toHaveBeenCalledWith('me')
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('объясняет серверный лимит и передаёт только пометку', async () => {
  mocks.rpc.mockResolvedValue({ error: { message: 'active invite limit' } })
  await expect(memberInviteApi('me').create('  Саша  ')).rejects.toThrow('3 активные')
  expect(mocks.rpc).toHaveBeenCalledWith('create_my_invite', { p_note: 'Саша' })
})
it('читает свои ссылки и отзывает по id', async () => {
  mocks.rpc.mockResolvedValue({ data: [] })
  await expect(memberInviteApi('me').list()).resolves.toEqual([])
  await memberInviteApi('me').revoke('id')
  expect(mocks.rpc).toHaveBeenLastCalledWith('revoke_my_invite', { p_id: 'id' })
})
