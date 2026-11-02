import { db } from './local.js'
import { syncNow } from './sync.js'
import { hasWorkoutDrafts } from '../lib/draftStore.js'

// Счетчик в шапке не включает dead-letter, реакции, цели и личные настройки.
// Проверяем реальную базу после синка. Неопределенность запрещает переход.
export async function checkDomainMigration(userId) {
  const d = db
  if (!userId || !d || d.name !== `gym_app_${userId}`) return 'account'
  if (!navigator.onLine) return 'offline'
  if (hasWorkoutDrafts(userId)) return 'draft'
  if (await syncNow(userId) !== true) return 'sync'
  if (db !== d) return 'account'
  const tables = [d.outbox, d.ex_outbox, d.tpl_outbox, d.reaction_outbox,
    d.workouts, d.exercises, d.templates, d.meta]
  const pending = await d.transaction('r', tables, async () => {
    const counts = await Promise.all([
      ...tables.slice(0, 4).map((t) => t.count()),
      ...tables.slice(4, 7).map((t) => t.filter((row) => Boolean(row._dirty)).count()),
    ])
    const state = (await d.meta.get('user_meta_state'))?.value
    const goals = (await d.meta.get(`goal_${userId}`))?.value
    return counts.some(Boolean) || Object.values(state ?? {}).some((s) => s?.dirty)
      || (Array.isArray(goals) ? goals : goals ? [goals] : []).some((g) => g._dirty)
  })
  if (db !== d) return 'account'
  if (hasWorkoutDrafts(userId)) return 'draft'
  return pending ? 'pending' : 'ready'
}
