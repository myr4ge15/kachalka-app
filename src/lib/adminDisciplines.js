import { supabase } from '../db/supabase.js'
import { db } from '../db/local.js'
import { withTimeout } from './withTimeout.js'
import { AdminError } from './admin.js'
import { invalidateRatingCache, fetchRatingCatalog } from '../db/disciplines.js'

export async function adminSaveDiscipline(userId, { exercise_id, split_by_sex, enabled = true }) {
  if (!exercise_id) throw new AdminError('Выбери упражнение')
  const d = db
  const { error } = await withTimeout(supabase.rpc('admin_save_discipline', {
    p_exercise_id: exercise_id, p_split_by_sex: Boolean(split_by_sex), p_enabled: Boolean(enabled),
  }))
  if (error) throw new AdminError(error.message || 'Не удалось сохранить дисциплину')
  // Не переносим результат запоздавшего запроса в базу другой учетной записи.
  if (db !== d) return
  await invalidateRatingCache(d)
  // Сохранение уже принято сервером. Ошибка обновления не превращает его в отказ.
  try { await fetchRatingCatalog(userId, { force: true }); return { refreshed: true } }
  catch { return { refreshed: false } }
}
