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

// Ключ личной цели в meta (одна цель на пользователя). Объект цели:
//   { exerciseId, exerciseName, targetWeight, achievedAt }  (achievedAt: null | ISO)
export const goalKey = (userId) => `goal_${userId}`

// Мои тренировки (без удалённых).
async function myWorkouts(userId) {
  const list = await db.workouts.where('user_id').equals(userId).toArray()
  return list.filter((w) => !w._deleted)
}

// Уведомление о достигнутой цели (🎯), если цель есть и уже достигнута.
// Один объект на пользователя (дедуп — через achievedAt в самой цели).
async function goalNotif(userId) {
  const goal = await getMeta(goalKey(userId))
  if (!goal?.achievedAt) return []
  return [{
    id: `goal:${goal.exerciseId}:${goal.targetWeight}`,
    type: 'goal',
    exId: goal.exerciseId,
    name: goal.exerciseName ?? '—',
    weight: goal.targetWeight,
    at: goal.achievedAt,
  }]
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

// Достигла ли сохранённая тренировка личную цель ВПЕРВЫЕ. Цель — в meta
// (goalKey). Считаем как рекорд: лучший вес по упражнению цели ДО этой
// тренировки был ниже target, а с её учётом стал ≥ target. При срабатывании
// проставляем achievedAt (дедуп — больше не сработает) и возвращаем
// { name, weight } для тоста; иначе null.
export async function detectGoalReachedOnSave(userId, workoutId) {
  const goal = await getMeta(goalKey(userId))
  if (!goal || !goal.exerciseId || !goal.targetWeight || goal.achievedAt) return null
  const all = await myWorkouts(userId)
  const cur = myBestByExercise(all).get(goal.exerciseId)?.weight ?? 0
  const prev = myBestByExercise(all.filter((w) => w.id !== workoutId)).get(goal.exerciseId)?.weight ?? 0
  if (!crossedGoal(prev, cur, goal.targetWeight)) return null
  await setMeta(goalKey(userId), { ...goal, achievedAt: nowIso() })
  return { name: goal.exerciseName ?? '—', weight: goal.targetWeight }
}
