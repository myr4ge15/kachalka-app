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

// Обновить снимок лидерборда с сервера. Тихо выходит офлайн / без конфигурации.
//
// Агрегация целиком на сервере (RPC leaderboard_bench, см. supabase/rpc.sql):
// Postgres сам считает лучший 1ПМ по жиму на каждого участника и возвращает по
// одной строке. Раньше клиент тянул всю историю жимов и считал в браузере.
export async function fetchLeaderboard() {
  if (!isConfigured || !navigator.onLine) return

  const res = await withTimeout(supabase.rpc('leaderboard_bench'))
  if (res.error) throw res.error

  const rows = (res.data ?? []).map((r) => ({
    user_id: r.user_id,
    user_name: r.user_name ?? 'Кто-то',
    orm: Number(r.orm),
    weight: Number(r.weight),
    reps: Number(r.reps),
    performed_at: r.performed_at ?? null,
  }))

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
