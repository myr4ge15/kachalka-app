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
import { cmpIsoAsc } from '../lib/cmp.js'

// Порядок рейтинга — по ФАКТИЧЕСКОМУ весу: тяжелее выше; при равном весе —
// больше повторов; при равных и весе, и повторах — кто достиг раньше.
export function cmpBoard(a, b) {
  return (
    Number(b.weight) - Number(a.weight) ||
    Number(b.reps) - Number(a.reps) ||
    cmpIsoAsc(a.performed_at, b.performed_at)
  )
}

// Обновить снимок лидерборда с сервера. Тихо выходит офлайн / без конфигурации.
//
// Агрегация целиком на сервере (RPC leaderboard_bench, см. supabase/rpc.sql):
// Postgres возвращает по одной строке на участника — самый тяжёлый ФАКТИЧЕСКИЙ
// подход (weight/reps/performed_at) и лучший расчётный 1ПМ (orm) по всей истории.
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

// Фолбэк-расчёт лидерборда из кэша Ленты — чистая функция (тестируемая).
//
// Зачем: серверный RPC `leaderboard_bench` может быть не задеплоен, и тогда
// `db.leaderboard` пуст, а рейтинг выглядит как «отсутствующая фича». Лента же
// (`db.feed`) почти всегда наполнена обычным `select` без RPC и содержит
// денормализованные `entries` с флагом `is_bench_lift` и подходами — этого
// достаточно, чтобы посчитать рейтинг по жиму на каждого участника прямо в
// браузере. Считаем по той же логике, что и сервер.
//
// Метрика — фактический максимальный вес (самый тяжёлый подход); 1ПМ (orm) —
// лучшая расчётная оценка по всей истории участника (формула Эпли,
// `setOneRepMax`), возможно из ДРУГОГО подхода, чем самый тяжёлый по весу.
//
// NB: окно Ленты ограничено (FEED_LIMIT), поэтому фолбэк — «лучший по недавним
// тренировкам», а не по всей истории. Точный рейтинг даёт серверный снимок;
// фолбэк нужен, чтобы рейтинг вообще был виден без задеплоенного RPC.
export function computeBoardFromFeed(feedItems) {
  const byUser = new Map() // user_id → лучшая строка рейтинга
  for (const w of feedItems ?? []) {
    for (const e of w.entries ?? []) {
      if (!e.is_bench_lift || !e.sets?.length) continue
      for (const s of e.sets) {
        const weight = Number(s.weight)
        const reps = Number(s.reps)
        if (!(weight > 0) || !(reps > 0)) continue
        const orm = setOneRepMax(weight, reps)
        const rec = byUser.get(w.user_id) ?? {
          user_id: w.user_id,
          user_name: w.user_name ?? 'Кто-то',
          weight: 0,
          reps: 0,
          performed_at: null,
          orm: 0,
        }
        // Лучший фактический подход: тяжелее, при равном весе — больше повторов.
        if (weight > rec.weight || (weight === rec.weight && reps > rec.reps)) {
          rec.weight = weight
          rec.reps = reps
          rec.performed_at = w.performed_at ?? null
        }
        if (orm > rec.orm) rec.orm = orm
        if (w.user_name) rec.user_name = w.user_name
        byUser.set(w.user_id, rec)
      }
    }
  }
  return [...byUser.values()].sort(cmpBoard)
}

// Лидерборд из локального кэша (офлайн-доступен), сильнейший сверху.
// Приоритет — серверный снимок (вся история). Если его нет (RPC не задеплоен /
// ещё не подтянулся) — фолбэк-расчёт из кэша Ленты, чтобы рейтинг был виден.
// Читаем обе таблицы внутри одной функции, поэтому useLiveQuery пересчитывает
// рейтинг и при обновлении снимка, и при обновлении Ленты.
export async function getCachedLeaderboard() {
  const snapshot = await db.leaderboard.toArray()
  if (snapshot.length) return snapshot.sort(cmpBoard)
  return computeBoardFromFeed(await db.feed.toArray())
}
