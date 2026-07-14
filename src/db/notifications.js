// ============================================================================
// Бейджи-уведомления о рекордах (ТЗ §4.5, MVP) — слой БД.
//
// Всё считается на клиенте из уже имеющихся данных, схему/синк не трогаем:
//   - «У тебя новый рекорд» — из локальной истории своих тренировок (db.workouts);
//   - «Друг побил твой рекорд» — из кэша общей ленты (db.feed).
// Чистые алгоритмы — в src/lib/records.js (тестируются в node). Здесь только
// чтение/запись Dexie и статус «прочитано».
//
// «Прочитано» — водяной знак времени в meta (notif_seen_at): непрочитано =
// событие новее метки. Открытие экрана двигает метку на самое свежее событие.
// ============================================================================
import { db, getMeta, setMeta, nowIso } from './local.js'
import { cmpIsoAsc, cmpIsoDesc } from '../lib/cmp.js'
import { myBestByExercise, minePrs, computeBeaten, computeNewPrs, crossedGoal, goalMetByExercise } from '../lib/records.js'
import { computeReactionNotifs } from '../lib/reactions.js'
import { buildInsights } from '../lib/insights.js'
import { BADGES } from '../lib/badges.js'
import { getBadges } from './repo.js'
import { getCachedLeaderboard } from './leaderboard.js'
import { normMetric } from '../lib/metric.js'
import { unreadCount } from '../lib/notifFilter.js'

// Метка «прочитано» неймспейснута по userId — иначе на общем устройстве второй
// вошедший наследует «прочитано» первого (notif_seen_at был глобальным). Старый
// глобальный ключ больше не читаем (станет мёртвым; одноразовый эффект — при
// первом открытии после обновления уведомления покажутся непрочитанными).
const seenKey = (userId) => `notif_seen_at_${userId}`
const LIMIT = 40 // сколько последних уведомлений держим в списке

// Ключ личных целей в meta. Мульти-цели (фаза 2c): значение — МАССИВ целей:
//   [{ exerciseId, exerciseName, metric, targetWeight, achievedAt, _dirty, _deleted }]
//   (achievedAt: null | ISO; _deleted: 1 → tombstone до отправки delete на сервер).
// metric (v1.16) — тип цели ('weight'/'reps'/'time'), как у упражнения; targetWeight
// несёт ЦЕЛЕВОЕ ведущее значение в единицах метрики (кг / повторы / секунды), как
// reps хранит секунды для time-упражнений. Легаси-цель без metric → 'weight'.
export const goalKey = (userId) => `goal_${userId}`

// Прочитать цели как МАССИВ. Совместимость: старое значение — одиночный объект
// цели (до мульти-целей) — мигрируем в массив на лету. Не персистим здесь (чтение
// зовётся и из useLiveQuery); первая же запись (save/sync) сохранит массив.
export async function readGoals(userId, d) {
  const v = await getMeta(goalKey(userId), d)
  if (Array.isArray(v)) return v
  if (v && v.exerciseId) {
    return [{
      exerciseId: v.exerciseId,
      exerciseName: v.exerciseName ?? '—',
      metric: v.metric ?? 'weight',
      targetWeight: v.targetWeight,
      achievedAt: v.achievedAt ?? null,
      _dirty: v._dirty ? 1 : 0,
    }]
  }
  return []
}

export async function writeGoals(userId, goals, d) {
  await setMeta(goalKey(userId), goals, d)
}

// Мои тренировки (без удалённых).
async function myWorkouts(userId) {
  const list = await db.workouts.where('user_id').equals(userId).toArray()
  return list.filter((w) => !w._deleted)
}

// Уведомления о достигнутых целях (🎯) — по одному на каждую достигнутую цель
// (дедуп — через achievedAt в самой цели).
async function goalNotif(userId) {
  const goals = await readGoals(userId)
  return goals
    .filter((g) => !g._deleted && g.achievedAt)
    .map((g) => ({
      id: `goal:${g.exerciseId}:${g.targetWeight}`,
      type: 'goal',
      exId: g.exerciseId,
      name: g.exerciseName ?? '—',
      metric: normMetric(g.metric),
      value: g.targetWeight,
      at: g.achievedAt,
    }))
}

// Инсайты как уведомления (виш BACKLOG «Инсайты»): авто-выводы движка правил
// (объём/серия/забытая группа/тренд/обгон/плато). Личный рекорд (kind 'pr') из
// набора исключаем — его уже показывает уведомление типа 'mine', не дублируем.
// Лидерборд подтягиваем для «обгона друга»; ошибка/пусто → без него.
async function insightNotifs(userId, workouts) {
  let leaderboard = null
  try { leaderboard = await getCachedLeaderboard() } catch { /* необязательно */ }
  return buildInsights({ workouts, leaderboard, userId, max: 3 })
    .filter((i) => i.kind !== 'pr')
    .map((i) => ({ id: `insight:${i.id}`, type: 'insight', emoji: i.emoji, tone: i.tone, text: i.text, at: i.at }))
}

// Достижения/бейджи как уведомления (PLAN-badges): полученные вехи из meta.
// Исторические (backfilled) НЕ показываем на колокольчике — они размечены задним
// числом и не должны спамить непрочитанным; в ленту идут только живые получения.
const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]))
async function badgeNotifs(userId) {
  const map = await getBadges(userId)
  return Object.entries(map)
    .filter(([id, rec]) => rec && !rec.backfilled && BADGE_BY_ID[id])
    .map(([id, rec]) => ({
      id: `badge:${id}`,
      type: 'badge',
      emoji: BADGE_BY_ID[id].icon,
      name: BADGE_BY_ID[id].name,
      at: rec.at,
    }))
}

// Полный список уведомлений (свежие сверху), ограниченный LIMIT.
export async function getNotifications(userId) {
  const workouts = await myWorkouts(userId)
  const feedItems = await db.feed.toArray()
  const myBest = myBestByExercise(workouts)
  const mine = minePrs(workouts)
  const beaten = computeBeaten(feedItems, userId, myBest)
  const goal = await goalNotif(userId)
  // Реакции на мои тренировки — из того же окна ленты (в нём есть и мои записи).
  const reactions = computeReactionNotifs(feedItems, userId)
  const insights = await insightNotifs(userId, workouts)
  const badges = await badgeNotifs(userId)
  return [...mine, ...beaten, ...goal, ...reactions, ...insights, ...badges]
    .sort((a, b) => cmpIsoDesc(a.at, b.at))
    .slice(0, LIMIT)
}

// Метка «последнего просмотра» (ISO, '' если ещё не открывали) — для своего userId.
export async function getSeenAt(userId) {
  return (await getMeta(seenKey(userId))) ?? ''
}

// Число непрочитанных (событие новее метки просмотра). Счётчик — чистый
// unreadCount (lib/notifFilter), db-слой лишь строит список и метку.
export async function countUnread(userId) {
  const [seen, list] = await Promise.all([getSeenAt(userId), getNotifications(userId)])
  return unreadCount(list, seen)
}

// Двигаем метку на время самого свежего уведомления (всё прочитано).
export async function markAllSeen(userId, list) {
  const seen = await getSeenAt(userId)
  const newest = (list ?? []).reduce(
    (m, n) => (cmpIsoAsc(m, n.at) < 0 ? n.at : m),
    seen
  )
  await setMeta(seenKey(userId), newest || nowIso())
}

// Новые личные рекорды, установленные ИМЕННО этой тренировкой (для тоста после
// сохранения). Сравниваем с лучшим по ВСЕМ ОСТАЛЬНЫМ моим тренировкам.
export async function detectNewPrsOnSave(userId, workoutId) {
  const all = await myWorkouts(userId)
  const saved = all.find((w) => w.id === workoutId)
  if (!saved) return []
  const othersBest = myBestByExercise(all.filter((w) => w.id !== workoutId))
  return computeNewPrs(saved.entries, othersBest)
}

// Какие личные цели достигнуты ВПЕРВЫЕ именно этой тренировкой. Идём по ВСЕМ
// не-достигнутым целям: ведущий показатель по упражнению цели (вес / повторы /
// секунды — по метрике упражнения) ДО этой тренировки был ниже target, а с её
// учётом стал ≥ target (как рекорд). myBestByExercise возвращает ведущее значение
// в единицах метрики упражнения, поэтому сравнение работает для всех метрик.
// Достигнутым проставляем achievedAt (дедуп) и возвращаем массив
// { name, metric, value } для тоста (пусто — ничего не достигнуто).
export async function detectGoalReachedOnSave(userId, workoutId) {
  const goals = await readGoals(userId)
  const hasActive = goals.some((g) => !g._deleted && g.exerciseId && g.targetWeight && !g.achievedAt)
  if (!hasActive) return []
  const all = await myWorkouts(userId)
  const prevAll = all.filter((w) => w.id !== workoutId)
  const bestAll = myBestByExercise(all)
  const bestPrev = myBestByExercise(prevAll)
  const reached = []
  let changed = false
  const next = goals.map((g) => {
    if (g._deleted || g.achievedAt || !g.exerciseId || !g.targetWeight) return g
    const m = normMetric(g.metric)
    let crossed
    if (m === 'weight') {
      // Весовая цель «вес × повторы» (PLAN-goal-reps): достижение — по ПОДХОДУ
      // (вес≥W И повт≥R), повторы необязательны (targetReps пуст → только вес).
      // Поэтому смотрим подходы, а не агрегированный максимум по весу.
      const prevMet = goalMetByExercise(prevAll, g.exerciseId, g.targetWeight, g.targetReps)
      const curMet = goalMetByExercise(all, g.exerciseId, g.targetWeight, g.targetReps)
      crossed = !prevMet && curMet
    } else {
      // reps/time: ведущая метрика одна (повторы/секунды) — старый расчёт по максимуму.
      const cur = bestAll.get(g.exerciseId)?.value ?? 0
      const prev = bestPrev.get(g.exerciseId)?.value ?? 0
      crossed = crossedGoal(prev, cur, g.targetWeight)
    }
    if (!crossed) return g
    changed = true
    reached.push({ name: g.exerciseName ?? '—', metric: m, value: g.targetWeight, reps: g.targetReps ?? null })
    return { ...g, achievedAt: nowIso() }
  })
  if (changed) await writeGoals(userId, next)
  return reached
}
