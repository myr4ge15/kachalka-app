// Мои круги («Мой круг») — снимок в персональном meta: Рейтинг и Лента показывают
// переключатель/подсказку и офлайн. Обновление — онлайн (lib/friendCircles.js).
import { db, getMeta, setMeta } from './local.js'
import { circleApi } from '../lib/friendCircles.js'

const KEY = 'fc_circles'

export function getMyCircles() {
  return db ? getMeta(KEY, db).then(v => v?.items ?? null) : Promise.resolve(null)
}

// Перечитать с сервера. Ошибку не бросаем (витрина живет на снимке) — возвращаем null.
export async function refreshMyCircles(userId) {
  const d = db
  if (!d || !navigator.onLine) return null
  try {
    const items = await circleApi(userId).myCircles()
    if (db !== d) return null
    await setMeta(KEY, { items, fetchedAt: new Date().toISOString() }, d)
    return items
  } catch {
    return null
  }
}
