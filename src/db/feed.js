// ============================================================================
// Общая лента тренировок друзей (ТЗ §4.3, §7 — MVP).
//
// Это read-only витрина: последние тренировки ВСЕХ участников, отсортированные
// по времени. В отличие от `workouts` (только свои записи, с правкой и очередью
// синхронизации) лента ничего не пишет на сервер — только тянет и кэширует.
//
// Офлайн-first: экран читает из локального кэша `feed` (мгновенно и работает без
// сети), а `fetchFeed()` в фоне обновляет снимок с сервера. Отметки рекордов
// считаются на клиенте по загруженному окну ленты.
// ============================================================================
import { supabase, isConfigured } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { db } from './local.js'
import { cmpIsoAsc, cmpIsoDesc } from '../lib/cmp.js'

// Максимальный фактический вес среди подходов [{weight, reps}].
function bestWeight(sets) {
  return sets.reduce((m, s) => Math.max(m, Number(s.weight) || 0), 0)
}

// Сколько последних тренировок показываем в ленте.
const FEED_LIMIT = 50

// Тянем тренировку целиком, плюс имя автора (join users).
const SELECT_FEED =
  'id, performed_at, user_id, ' +
  'user:users(id, name), ' +
  'workout_exercises(id, position, exercise_id, ' +
  'exercise:exercises(id, name, muscle_group, is_bench_lift), ' +
  'sets(id, set_number, weight, reps))'

// server row → элемент ленты (денормализованный, с готовой сводкой).
function rowToItem(w) {
  const entries = [...(w.workout_exercises ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((we) => {
      const sets = [...(we.sets ?? [])]
        .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
        .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) }))
      return {
        exercise_id: we.exercise_id,
        name: we.exercise?.name ?? '—',
        muscle_group: we.exercise?.muscle_group ?? null,
        is_bench_lift: Boolean(we.exercise?.is_bench_lift),
        sets,
      }
    })

  // Сводка для подвала карточки
  const exCount = entries.length
  const setCount = entries.reduce((n, e) => n + e.sets.length, 0)
  const tonnage = entries.reduce(
    (sum, e) => sum + e.sets.reduce((s, x) => s + x.weight * x.reps, 0),
    0
  )

  return {
    id: w.id,
    user_id: w.user_id,
    user_name: w.user?.name ?? 'Кто-то',
    performed_at: w.performed_at,
    entries,
    exCount,
    setCount,
    tonnage: Math.round(tonnage),
    prs: [], // заполняется в computePrs()
  }
}

// Отметки новых рекордов в ленте (ТЗ §4.3).
// Идём по всему окну ленты в хронологическом порядке и для каждого автора
// отдельно отслеживаем лучший ФАКТИЧЕСКИЙ вес по упражнению. Если в тренировке
// упражнение превысило прежний максимум веса этого автора (в пределах окна) —
// это рекорд. Согласовано с лидербордом: рекорд = новый максимальный реальный
// вес, а не расчётный 1ПМ (раньше всплывал «рекорд» с весом, который не жали).
// NB: окно ограничено FEED_LIMIT, поэтому рекорды считаются «по недавним
// тренировкам», а не по всей истории — для ленты этого достаточно.
function computePrs(items) {
  const byUser = new Map() // user_id → Map(exercise_id → bestWeight)
  const chronological = [...items].sort((a, b) =>
    cmpIsoAsc(a.performed_at, b.performed_at)
  )
  for (const item of chronological) {
    let best = byUser.get(item.user_id)
    if (!best) {
      best = new Map()
      byUser.set(item.user_id, best)
    }
    for (const e of item.entries) {
      if (e.sets.length === 0) continue
      const weight = bestWeight(e.sets)
      if (weight <= 0) continue
      const prev = best.get(e.exercise_id) ?? 0
      if (weight > prev) {
        // первый замер по упражнению рекордом не считаем (нечего бить)
        if (prev > 0) item.prs.push({ name: e.name, weight })
        best.set(e.exercise_id, weight)
      }
    }
  }
}

// Обновить снимок ленты с сервера. Тихо выходит офлайн / без конфигурации.
export async function fetchFeed() {
  if (!isConfigured || !navigator.onLine) return
  const res = await withTimeout(
    supabase
      .from('workouts')
      .select(SELECT_FEED)
      .order('performed_at', { ascending: false })
      .limit(FEED_LIMIT)
  )
  if (res.error) throw res.error

  const items = (res.data ?? []).map(rowToItem)
  computePrs(items)

  // Успешный ответ (в т.ч. ПУСТОЙ) применяем целиком: сетевые/серверные сбои
  // уходят в throw выше и сюда не доходят, поэтому пустой список здесь —
  // это легитимно «нечего показывать» (например, у приватного пользователя,
  // которому RLS отдаёт только свои тренировки). Раньше пустой ответ не
  // затирал кэш, и приватный видел устаревший снимок общей ленты.
  await db.transaction('rw', db.feed, async () => {
    await db.feed.clear()
    await db.feed.bulkPut(items)
  })
}

// Лента из локального кэша (офлайн-доступна), свежее сверху.
export async function getCachedFeed() {
  const list = await db.feed.toArray()
  return list.sort((a, b) => cmpIsoDesc(a.performed_at, b.performed_at))
}
