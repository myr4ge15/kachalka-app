// ============================================================================
// Лидерборд (ТЗ §4.3, §8.3 — MVP) — два борда по полу (v1.13.0).
//
// Мужской борд — по жиму лёжа (`is_bench_lift`), женский — по ягодичному мостику
// (`is_female_lift`); у девушек жим в рейтинге не показывается. Пол участника —
// users.sex ('m'|'f'|NULL); неизвестный пол → мужской борд (обратная совместимость).
// Метрика — фактический макс. вес подхода; 1ПМ (Эпли, lib/oneRepMax) — сноской.
//
// Это read-only витрина, как и лента: ничего не пишем на сервер. Считаем по
// ВСЕЙ истории (не по окну, в отличие от ленты), чтобы «лучший за всё время»
// был честным. Для закрытого круга ~5 человек объём данных крошечный.
//
// Офлайн-first: экран читает из локального кэша `leaderboard` (мгновенно и
// работает без сети), а `fetchLeaderboard()` в фоне обновляет снимок с сервера.
// ============================================================================
import { supabase, isConfigured, hasSession } from './supabase.js'
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
  // Та же гонка, что и в fetchFeed: до готовности сессии RPC уходит ролью `anon`
  // и ловит «permission denied». Ждём сессию (см. hasSession), иначе тихо выходим.
  if (!(await hasSession())) return

  const res = await withTimeout(supabase.rpc('leaderboard_bench'))
  if (res.error) throw res.error

  // board: 'm' (жим) | 'f' (ягодичный мостик). Старый сервер без поля board →
  // 'm' (обратная совместимость: один рейтинг = мужской борд, как было раньше).
  const rows = (res.data ?? []).map((r) => ({
    board: r.board === 'f' ? 'f' : 'm',
    user_id: r.user_id,
    user_name: r.user_name ?? 'Кто-то',
    orm: Number(r.orm),
    weight: Number(r.weight),
    reps: Number(r.reps),
    performed_at: r.performed_at ?? null,
  }))

  // Пустой (но НЕ ошибочный) ответ не затираем валидным снимком — иначе при
  // временном сбое RPC рейтинг «схлопнется» в пустой. Заменяем только при данных.
  if (rows.length === 0) return

  await db.transaction('rw', db.leaderboard, async () => {
    await db.leaderboard.clear()
    await db.leaderboard.bulkPut(rows)
  })
}

// Разбить плоский список строк рейтинга на два борда по полю board и отсортировать
// каждый. Мужской борд — board !== 'f' (вкл. строки без board от старого сервера).
export function splitBoards(rows) {
  const male = []
  const female = []
  for (const r of rows ?? []) (r.board === 'f' ? female : male).push(r)
  return { male: male.sort(cmpBoard), female: female.sort(cmpBoard) }
}

// Фолбэк-расчёт лидерборда из кэша Ленты — чистая функция (тестируемая).
//
// Зачем: серверный RPC `leaderboard_bench` может быть не задеплоен, и тогда
// `db.leaderboard` пуст, а рейтинг выглядит как «отсутствующая фича». Лента же
// (`db.feed`) почти всегда наполнена обычным `select` без RPC и содержит
// денормализованные `entries` с флагами `is_bench_lift`/`is_female_lift` и
// подходами — этого достаточно, чтобы посчитать рейтинг прямо в браузере.
//
// Два борда: мужской — по жиму (is_bench_lift) для участников с полом ≠ 'f'
// (вкл. неизвестный пол); женский — по ягодичному мостику (is_female_lift) для
// пола 'f'. Пол берём из карты sexById (id → 'm'|'f'|undefined) — её строит
// getCachedLeaderboard из кэша пользователей (login_users.sex). Логика
// совпадает с серверной leaderboard_bench.
//
// Метрика — фактический максимальный вес (самый тяжёлый подход); 1ПМ (orm) —
// лучшая расчётная оценка (формула Эпли). NB: окно Ленты ограничено (FEED_LIMIT),
// поэтому фолбэк — «лучший по недавним тренировкам», а не по всей истории.
export function computeBoardFromFeed(feedItems, sexById) {
  const sex = sexById ?? new Map()
  const byUser = new Map() // user_id → лучшая строка рейтинга
  for (const w of feedItems ?? []) {
    const board = sex.get(w.user_id) === 'f' ? 'f' : 'm'
    for (const e of w.entries ?? []) {
      // Каждый борд считает по своему ведущему упражнению.
      const lead = board === 'f' ? e.is_female_lift : e.is_bench_lift
      if (!lead || !e.sets?.length) continue
      for (const s of e.sets) {
        const weight = Number(s.weight)
        const reps = Number(s.reps)
        if (!(weight > 0) || !(reps > 0)) continue
        const orm = setOneRepMax(weight, reps)
        const rec = byUser.get(w.user_id) ?? {
          board,
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
  return splitBoards([...byUser.values()])
}

// Лидерборд из локального кэша (офлайн-доступен), сильнейший сверху. Возвращает
// { male, female } — два борда (мужской по жиму, женский по ягодичному мостику).
// Приоритет — серверный снимок (вся история). Если его нет (RPC не задеплоен /
// ещё не подтянулся) — фолбэк-расчёт из кэша Ленты, чтобы рейтинг был виден.
// Читаем все нужные таблицы внутри одной функции, поэтому useLiveQuery
// пересчитывает рейтинг и при обновлении снимка, и при обновлении Ленты.
export async function getCachedLeaderboard() {
  const snapshot = await db.leaderboard.toArray()
  if (snapshot.length) return splitBoards(snapshot)
  const users = await db.users.toArray()
  const sexById = new Map(users.map((u) => [u.id, u.sex]))
  return computeBoardFromFeed(await db.feed.toArray(), sexById)
}

// Имена ведущих упражнений бордов (для заголовков карточек). Берём из локального
// справочника по флагам; null → экран покажет дефолтную подпись.
export async function getLeadExerciseNames() {
  const list = await db.exercises.toArray()
  return {
    male: list.find((e) => e.is_bench_lift)?.name ?? null,
    female: list.find((e) => e.is_female_lift)?.name ?? null,
  }
}
