import { supabase, hasSession } from '../db/supabase.js'
import { withTimeout } from './withTimeout.js'

async function call(userId, name, args) {
  if (!await hasSession(userId)) throw new Error('Войди в свою учётную запись с интернетом.')
  const { data, error } = await withTimeout(supabase.rpc(name, args))
  if (error) {
    const message = error.message || ''
    if (message.includes('active invite limit')) throw new Error('У тебя уже 3 активные ссылки. Отзови ненужную или дождись регистрации участника.')
    if (error.code === '42501') throw new Error('Сессия завершилась. Войди заново.')
    if (error.code === 'PGRST202') throw new Error('Приглашения пока недоступны. Попробуй позже.')
    if (message.includes('already used')) throw new Error('По этой ссылке уже зарегистрировались.')
    if (message.includes('not found')) throw new Error('Приглашение не найдено.')
    throw new Error('Не удалось выполнить действие. Проверь связь и попробуй ещё раз.')
  }
  return data
}

export function memberInviteApi(userId) {
  return {
    async list() { return await call(userId, 'my_invites') || [] },
    async create(note = '') {
      const clean = String(note).trim()
      if (clean.length > 60) throw new Error('Пометка — до 60 символов.')
      const data = await call(userId, 'create_my_invite', { p_note: clean || null })
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.token) throw new Error('Сервер не вернул ссылку.')
      return row
    },
    async revoke(id) { await call(userId, 'revoke_my_invite', { p_id: id }) },
  }
}
