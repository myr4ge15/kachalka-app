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
import { myBestByExercise, minePrs, computeBeaten, computeNewPrs, crossedGoal } from '../lib/records.js'

const SEEN_KEY = 'notif_seen_at'
const LIMIT = 40 // сколько последних уведомлений держим в списке

// Ключ личных целей в meta. Мульти-цели (фаза 2c): значение — МАССИВ целей:
//   [{ exerciseId, exerciseName, targetWeight, achievedAt, _dirty, _deleted }]
//   (achievedAt: null | ISO; _deleted: 1 → tombstone до отправки delete на сервер).
export const goalKey = (userId) => `goal_${userId}`

// Прочитать цели как МАССИВ. Совместимость: старое значение — одиночный объект
// цели (до мульти-целей) — мигрируем в массив на лету. Не персистим здесь (чтение
// зовётся и из useLiveQuery); первая же запись (save/sync) сохранит массив.
export async function readGoals(userId) {
  const v = await getMeta(goalKey(userId))
  if (Array.isArray(v)) return v
  if (v && v.exerciseId) {
    return [{
      exerciseId: v.exerciseId,
      exerciseName: v.exerciseName ?? '—',
      targetWeight: v.targetWeight,
      achievedAt: v.achievedAt ?? null,
      _dirty: v._dirty ? 1 : 0,
    }]
  }
  return []
}

export async function writeGoals(userId, goals) {
  await setMeta(goalKey(userId), goals)
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
      weight: g.targetWeight,
      at: g.achievedAt,
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
  return [...mine, ...beaten, ...goal]
    .sort((a, b) => cmpIsoDesc(a.at, b.at))
    .slice(0, LIMIT)
}

// Метка «последнего просмотра» (ISO, '' если ещё не открывали).
export async function getSeenAt() {
  return (await getMeta(SEEN_KEY)) ?? ''
}

// Число непрочитанных (событие новее метки просмотра).
export async function countUnread(userId) {
  const [seen, list] = await Promise.all([getSeenAt(), getNotifications(userId)])
  return list.filter((n) => cmpIsoAsc(seen, n.at) < 0).length
}

// Двигаем метку на время самого свежего уведомления (всё прочитано).
export async function markAllSeen(list) {
  const seen = await getSeenAt()
  const newest = (list ?? []).reduce(
    (m, n) => (cmpIsoAsc(m, n.at) < 0 ? n.at : m),
    seen
  )
  await setMeta(SEEN_KEY, newest || nowIso())
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
// не-достигнутым целям: лучший вес по упражнению цели ДО этой тренировки был ниже
// target, а с её учётом стал ≥ target (как рекорд). Достигнутым проставляем
// achievedAt (дедуп — больше не сработают) и возвращаем массив { name, weight }
// для тоста (пусто — ничего не достигнуто). bestPrev/bestAll считаем один раз.
export async function detectGoalReachedOnSave(userId, workoutId) {
  const goals = await readGoals(userId)
  const hasActive = goals.some((g) => !g._deleted && g.exerciseId && g.targetWeight && !g.achievedAt)
  if (!hasActive) return []
  const all = await myWorkouts(userId)
  const bestAll = myBestByExercise(all)
  const bestPrev = myBestByExercise(all.filter((w) => w.id !== workoutId))
  const reached = []
  let changed = false
  const next = goals.map((g) => {
    if (g._deleted || g.achievedAt || !g.exerciseId || !g.targetWeight) return g
    // Цели — только весовые: ведущее значение весового упражнения = макс. вес.
    const cur = bestAll.get(g.exerciseId)?.value ?? 0
    const prev = bestPrev.get(g.exerciseId)?.value ?? 0
    if (!crossedGoal(prev, cur, g.targetWeight)) return g
    changed = true
    reached.push({ name: g.exerciseName ?? '—', weight: g.targetWeight })
    return { ...g, achievedAt: nowIso() }
  })
  if (changed) await writeGoals(userId, next)
  return reached
}
