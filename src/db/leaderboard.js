// ============================================================================
// Лидерборд по жиму лёжа (ТЗ §4.3, §8.3 — MVP).
//
// Согласованное решение (ТЗ §8.3): рейтинг считается ТОЛЬКО по жиму лёжа со
// штангой — это упражнение помечено флагом `is_bench_lift` в справочнике.
// Метрика — расчётный максимум «на раз» (1ПМ, формула Эпли, см. lib/oneRepMax).
//
// Это read-only витрина, как и лента: ничего не пишем на сервер. Считаем по
// ВСЕЙ истории (не по окну, в отличие от ленты), чтобы «лучший за всё время»
// был честным. Для закрытого круга ~5 человек объём данных крошечный.
//
// Офлайн-first: экран читает из локального кэша `leaderboard` (мгновенно и
// работает без сети), а `fetchLeaderboard()` в фоне обновляет снимок с сервера.
// ============================================================================
import { supabase, isConfigured } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { db } from './local.js'
import { setOneRepMax } from '../lib/oneRepMax.js'

// Лучший подход в списке по расчётному 1ПМ. Возвращаем сам 1ПМ и подход,
// который его дал (для подписи «100×3» под результатом).
function bestSet(sets) {
  let best = { orm: 0, weight: 0, reps: 0 }
  for (const s of sets) {
    const weight = Number(s.weight)
    const reps = Number(s.reps)
    if (!Number.isFinite(weight) || !Number.isFinite(reps) || reps <= 0) continue
    const orm = setOneRepMax(weight, reps)
    if (orm > best.orm) best = { orm, weight, reps }
  }
  return best
}

// Обновить снимок лидерборда с сервера. Тихо выходит офлайн / без конфигурации.
//
// Два запроса вместо хитрого встроенного фильтра по связанной таблице:
//   1) id упражнений-жимов (флаг is_bench_lift) — обычно одна строка;
//   2) все выполненные жимы с подходами и автором тренировки.
// Затем на клиенте берём по каждому участнику его лучший 1ПМ за всю историю.
export async function fetchLeaderboard() {
  if (!isConfigured || !navigator.onLine) return

  const benchRes = await withTimeout(
    supabase.from('exercises').select('id').eq('is_bench_lift', true)
  )
  if (benchRes.error) throw benchRes.error
  const benchIds = (benchRes.data ?? []).map((e) => e.id)
  if (benchIds.length === 0) {
    await db.leaderboard.clear()
    return
  }

  const res = await withTimeout(
    supabase
      .from('workout_exercises')
      .select(
        'workout:workouts(user_id, performed_at, user:users(id, name)), ' +
        'sets(weight, reps)'
      )
      .in('exercise_id', benchIds)
  )
  if (res.error) throw res.error

  // user_id → лучший результат по всей истории
  const byUser = new Map()
  for (const we of res.data ?? []) {
    const w = we.workout
    const userId = w?.user_id
    if (!userId) continue
    const best = bestSet(we.sets ?? [])
    if (best.orm <= 0) continue

    const prev = byUser.get(userId)
    if (!prev || best.orm > prev.orm) {
      byUser.set(userId, {
        user_id: userId,
        user_name: w.user?.name ?? 'Кто-то',
        orm: best.orm,
        weight: best.weight,
        reps: best.reps,
        performed_at: w.performed_at ?? null,
      })
    }
  }

  const rows = [...byUser.values()]
  await db.transaction('rw', db.leaderboard, async () => {
    await db.leaderboard.clear()
    if (rows.length) await db.leaderboard.bulkPut(rows)
  })
}

// Лидерборд из локального кэша (офлайн-доступен), сильнейший сверху.
export async function getCachedLeaderboard() {
  const list = await db.leaderboard.toArray()
  return list.sort((a, b) => b.orm - a.orm)
}
