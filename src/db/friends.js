// «Друзья» — снимок fr_list в персональном meta: профиль участника и бейдж заявок
// работают и офлайн (только чтение). Обновление — онлайн (lib/friends.js).
import { db, getMeta, setMeta } from './local.js'
import { friendsApi } from '../lib/friends.js'

const KEY = 'fr_list'

export function getFriends() {
  return db ? getMeta(KEY, db).then(v => v?.items ?? null) : Promise.resolve(null)
}

// Перечитать с сервера. Ошибку не бросаем (витрина живет на снимке) — возвращаем null.
export async function refreshFriends(userId) {
  const d = db
  if (!d || !navigator.onLine) return null
  try {
    const items = await friendsApi(userId).list()
    if (db !== d) return null
    await setMeta(KEY, { items, fetchedAt: new Date().toISOString() }, d)
    return items
  } catch {
    return null
  }
}
