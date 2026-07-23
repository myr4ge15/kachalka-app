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
import { supabase, isConfigured, hasSession } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { db, getMeta, setMeta } from './local.js'
import { getCachedUser } from './repo.js'
import { cmpIsoAsc, cmpIsoDesc } from '../lib/cmp.js'
import { leadingValue, normMetric } from '../lib/metric.js'
import { applyReactionQueue } from '../lib/reactions.js'
import { rosterSignature } from '../lib/pullWatermark.js'

// Сколько последних тренировок показываем в ленте.
const FEED_LIMIT = 50
// Сигнатура окна ленты (id + max updated_at по видимым 50 строкам) в meta. Пока
// она не изменилась — тяжёлый вложенный join (workout_exercises→exercise→sets)
// НЕ тянем: реакции обновляем поверх кэша дешёвым отдельным запросом.
const FEED_SIG = 'sig_feed'

// Тянем тренировку целиком, плюс имя автора (join users). Связь users указываем
// ЯВНО по FK-констрейнту workouts_user_id_fkey: после появления таблицы reactions
// (ссылается и на workouts, и на users) у PostgREST стало ДВА пути workouts↔users
// (прямой + через reactions), и неявный `users(...)` падает с «more than one
// relationship was found». Явный `!fk` снимает неоднозначность.
const SELECT_FEED =
  'id, performed_at, user_id, ' +
  'user:users!workouts_user_id_fkey(id, name), ' +
  'workout_exercises(id, position, exercise_id, ' +
  'exercise:exercises(id, name, muscle_group, is_bench_lift, is_female_lift, metric), ' +
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
        is_female_lift: Boolean(we.exercise?.is_female_lift),
        metric: normMetric(we.exercise?.metric),
        sets,
      }
    })

  // Сводка для подвала карточки. Тоннаж — только по весовым подходам (у reps/time
  // weight=0, поэтому слагаемое и так 0; формула остаётся прежней).
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
    reactions: [], // [{ user_id, name, kind }] — заполняется в attachReactions()
  }
}

// Догрузить реакции для окна ленты и приклеить к элементам. Отдельным запросом
// (а не вложенным select) — проще и не зависит от RLS-join. Таблицы reactions
// может ещё не быть на сервере (поэтапная раскатка) → тихо оставляем пусто.
async function attachReactions(items) {
  if (items.length === 0) return
  const ids = items.map((i) => i.id)
  try {
    const res = await withTimeout(
      supabase
        .from('reactions')
        .select('workout_id, user_id, kind, created_at, user:users!reactions_user_id_fkey(name)')
        .in('workout_id', ids)
    )
    if (res.error || !res.data) return
    const byWorkout = new Map()
    for (const r of res.data) {
      if (!byWorkout.has(r.workout_id)) byWorkout.set(r.workout_id, [])
      byWorkout.get(r.workout_id).push({
        user_id: r.user_id,
        name: r.user?.name ?? '—',
        kind: r.kind,
        created_at: r.created_at ?? null, // для уведомлений о реакциях (водяной знак времени)
      })
    }
    for (const item of items) item.reactions = byWorkout.get(item.id) ?? []
  } catch { /* нет таблицы/офлайн — карточки без реакций */ }
}

// Отметки новых рекордов в ленте (ТЗ §4.3).
// Идём по всему окну ленты в хронологическом порядке и для каждого автора
// отдельно отслеживаем лучший ВЕДУЩИЙ показатель по упражнению (вес для weight,
// макс. повторов/секунд для reps/time). Если в тренировке упражнение превысило
// прежний максимум этого автора (в пределах окна) — это рекорд. Рекорд = лучший
// единичный подход (а не расчётный 1ПМ). NB: окно ограничено FEED_LIMIT, поэтому
// рекорды считаются «по недавним тренировкам», а не по всей истории.
function computePrs(items) {
  const byUser = new Map() // user_id → Map(exercise_id → лучшее ведущее значение)
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
      const value = leadingValue(e.metric, e.sets)
      if (value <= 0) continue
      const prev = best.get(e.exercise_id) ?? 0
      if (value > prev) {
        // первый замер по упражнению рекордом не считаем (нечего бить)
        if (prev > 0) item.prs.push({ name: e.name, metric: e.metric, value })
        best.set(e.exercise_id, value)
      }
    }
  }
}

// Обновить снимок ленты с сервера. Тихо выходит офлайн / без конфигурации.
// userId — текущий пользователь: нужен, чтобы наложить его локальную очередь
// реакций (reaction_outbox) на свежий снимок (оптимистичные тапы не пропадают).
// d — явный инстанс базы (движок синка захватывает его на входе, см. syncNow):
// иначе при смене учётки посреди сетевого запроса снимок ленты A мог бы записаться
// в базу B (кросс-протечка ленты). При свопе d уже закрыт → transaction бросит,
// вызов обёрнут в try/catch в syncNow.
export async function fetchFeed(userId, d = db) {
  if (!isConfigured || !navigator.onLine) return
  // Не читаем `workouts`, пока не поднята настоящая сессия: иначе запрос уходит
  // ролью `anon` (после auth-harden у неё нет грантов) → «permission denied for
  // table workouts». Тихо выходим, как при офлайне; повторно дёрнет либо poll
  // синка, либо ре-триггер по onAuthStateChange (SIGNED_IN), см. sync.startSync.
  if (!(await hasSession())) return

  // Дешёвая проба окна ленты (id + updated_at по тем же 50 строкам). Тяжёлый
  // вложенный join тянем ТОЛЬКО когда окно изменилось (новая/правленая/удалённая
  // тренировка → меняется набор id или max updated_at). В устоявшемся состоянии
  // (обычный случай при поллинге раз в 20–60 c) этого не происходит — и мы вместо
  // тяжёлого join'а берём кэш ленты. Реакции обновляем ВСЕГДА (лёгкий отдельный
  // запрос ниже): чужой лайк должен появляться без правки самой тренировки.
  const probe = await withTimeout(
    supabase
      .from('workouts')
      .select('id, updated_at')
      .order('performed_at', { ascending: false })
      .limit(FEED_LIMIT)
  )
  if (probe.error) throw probe.error
  const sig = rosterSignature(probe.data ?? [])
  const changed = sig !== (await getMeta(FEED_SIG, d))

  let items
  if (changed) {
    const res = await withTimeout(
      supabase
        .from('workouts')
        .select(SELECT_FEED)
        .order('performed_at', { ascending: false })
        .limit(FEED_LIMIT)
    )
    if (res.error) throw res.error
    items = (res.data ?? []).map(rowToItem)
    computePrs(items)
  } else {
    // Окно ленты не изменилось — берём готовый кэш (тот же порядок «свежее сверху»,
    // с уже посчитанными prs) и лишь переналожим свежие реакции. Кэш пуст (первый
    // прогон/сброс) → sig не совпал бы, сюда мы бы не попали.
    items = await d.feed.toArray()
    items.sort((a, b) => cmpIsoDesc(a.performed_at, b.performed_at))
  }
  await attachReactions(items)

  // Оптимистичная очередь реакций поверх серверного снимка: ещё не отправленные
  // (или отправляемые прямо сейчас) МОИ тапы не должны пропадать при перезаписи
  // кэша. me — из общего ростра (loginDb) по userId.
  let finalItems = items
  try {
    const ops = await d.reaction_outbox.toArray()
    if (ops.length && userId) {
      const me = await getCachedUser(userId)
      finalItems = applyReactionQueue(items, ops, { id: userId, name: me?.name })
    }
  } catch { /* нет очереди/ростра — показываем как есть */ }

  // Успешный ответ (в т.ч. ПУСТОЙ) применяем целиком: сетевые/серверные сбои
  // уходят в throw выше и сюда не доходят, поэтому пустой список здесь —
  // это легитимно «нечего показывать» (например, у приватного пользователя,
  // которому RLS отдаёт только свои тренировки). Раньше пустой ответ не
  // затирал кэш, и приватный видел устаревший снимок общей ленты.
  await d.transaction('rw', d.feed, async () => {
    await d.feed.clear()
    await d.feed.bulkPut(finalItems)
  })
  // Запоминаем сигнатуру окна ПОСЛЕ успешной записи: следующий прогон пропустит
  // тяжёлый join, пока окно не изменится. Сетевые/серверные сбои уходят в throw
  // выше и сюда не доходят, поэтому метку не двигают.
  await setMeta(FEED_SIG, sig, d)
}

// Лента из локального кэша (офлайн-доступна), свежее сверху.
export async function getCachedFeed() {
  const list = await db.feed.toArray()
  return list.sort((a, b) => cmpIsoDesc(a.performed_at, b.performed_at))
}
