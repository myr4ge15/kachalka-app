// Read-only витрина. Снимки в персональном meta, схема Dexie не меняется.
// Настройки администратора — онлайн RPC из lib/adminDisciplines.js.
import { db, getMeta, setMeta } from './local.js'
import { supabase, isConfigured, hasSession, serverIdentity } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { shouldRefetchLeaderboard } from '../lib/leaderboardCache.js'
import { disciplineSignature, compareDisciplineRows } from '../lib/disciplines.js'

const CATALOG = 'rating_catalog'
const boardKey = id => `rating_board_${id}`
const pending = new WeakMap()
const revisions = new WeakMap()

export function getRatingCatalog() {
  return db ? getMeta(CATALOG, db).then(v => v ?? null) : Promise.resolve(null)
}

export async function getRatingBoard(discipline) {
  if (!db || !discipline) return null
  const snapshot = await getMeta(boardKey(discipline.id), db)
  return snapshot?.signature === disciplineSignature(discipline)
    ? { ...snapshot, rows: snapshot.rows.slice().sort(compareDisciplineRows) } : null
}

async function once(d, key, action) {
  let tasks = pending.get(d)
  if (!tasks) { tasks = new Map(); pending.set(d, tasks) }
  if (tasks.has(key)) return tasks.get(key)
  const promise = action().finally(() => tasks.delete(key))
  tasks.set(key, promise)
  return promise
}

async function identity(userId) {
  if (!(await hasSession(userId))) return false
  const result = await withTimeout(serverIdentity())
  return result.known && result.id === userId
}

export async function fetchRatingCatalog(userId, { force = false } = {}) {
  const d = db
  if (!d || !isConfigured || !navigator.onLine) return
  return once(d, CATALOG, async () => {
    const revision = revisions.get(d)
    if (!(await identity(userId)) || db !== d) return
    const old = await getMeta(CATALOG, d)
    if (!force && old && !shouldRefetchLeaderboard(old.fetchedAt, Date.now())) return
    const { data, error } = await withTimeout(supabase.rpc('rating_catalog'))
    if (error) throw error
    if (db !== d || !(await identity(userId)) || revision !== revisions.get(d)) return
    if (!Array.isArray(data)) throw new Error('Не удалось прочитать список дисциплин')
    await setMeta(CATALOG, { items: data, fetchedAt: new Date().toISOString() }, d)
  })
}

export async function fetchRatingBoard(userId, discipline, { force = false } = {}) {
  const d = db
  if (!d || !discipline || !isConfigured || !navigator.onLine) return
  return once(d, boardKey(discipline.id), async () => {
    const revision = revisions.get(d)
    if (!(await identity(userId)) || db !== d) return
    const old = await getMeta(boardKey(discipline.id), d)
    if (!force && old?.signature === disciplineSignature(discipline)
      && !shouldRefetchLeaderboard(old.fetchedAt, Date.now())) return
    const { data, error } = await withTimeout(supabase.rpc('rating_board', { p_discipline_id: discipline.id }))
    if (error) throw error
    if (db !== d || !(await identity(userId)) || revision !== revisions.get(d)) return
    if (!data?.discipline || !Array.isArray(data.rows)) throw new Error('Не удалось прочитать рейтинг')
    // Метрика и настройки приходят с результатами одним снимком. Нельзя показать
    // секунды из нового контракта как килограммы старой записи каталога.
    await d.transaction('rw', d.meta, async () => {
      const catalog = await getMeta(CATALOG, d)
      if (catalog) await setMeta(CATALOG, { ...catalog,
        items: catalog.items.map(item => item.id === data.discipline.id ? data.discipline : item) }, d)
      await setMeta(boardKey(discipline.id), {
        signature: disciplineSignature(data.discipline),
        rows: data.rows.map(row => ({ ...row, metric: data.discipline.metric,
          value: Number(row.value), weight: Number(row.weight), reps: Number(row.reps), orm: Number(row.orm) || 0,
        })).sort(compareDisciplineRows),
        fetchedAt: new Date().toISOString(),
      }, d)
    })
  })
}

export async function invalidateRatingCache(d = db) {
  if (!d) return
  revisions.set(d, (revisions.get(d) || 0) + 1)
  pending.delete(d)
  await d.transaction('rw', d.meta, async () => {
    await d.meta.where('key').startsWith('rating_').delete()
  })
}
