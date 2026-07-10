// ============================================================================
// Инсайты и домашняя сводка — слой БД (виши BACKLOG «✨ Инсайты» / «Домашняя
// сводка»). Читает уже локальные данные (Dexie) и кормит их чистым движкам
// (src/lib/insights.js, src/lib/homeSummary.js). Схему/синк не трогаем.
//
// Всё считается из имеющегося: свои тренировки (db.workouts), кэш ленты (db.feed —
// не нужен движку напрямую, но лидерборд для «обгона» берём из кэша), цели (meta),
// снимок лидерборда (getCachedLeaderboard). Сеть не требуется — офлайн-доступно.
// ============================================================================
import { getWorkouts } from './repo.js'
import { getCachedLeaderboard } from './leaderboard.js'
import { readGoals } from './notifications.js'
import { buildInsights } from '../lib/insights.js'
import { buildHomeSummary } from '../lib/homeSummary.js'
import { groupFreshness, imbalance as computeImbalance } from '../lib/freshness.js'

// Снимок лидерборда без падений (для «обгона друга»). Пусто/ошибка → null.
async function safeLeaderboard() {
  try {
    return await getCachedLeaderboard()
  } catch {
    return null
  }
}

// Инсайты для показа (уведомления/Главная): контекст — самая свежая тренировка.
// leaderboard подгружаем для правила «обгон друга».
export async function getInsights(userId, { max = 3 } = {}) {
  const [workouts, leaderboard] = await Promise.all([getWorkouts(userId), safeLeaderboard()])
  return buildInsights({ workouts, leaderboard, userId, max })
}

// Инсайты именно этой (только что сохранённой) тренировки — для тоста после
// сохранения. leaderboard тоже тянем, чтобы «обгон» мог всплыть сразу.
export async function detectInsightsOnSave(userId, workoutId, { max = 3 } = {}) {
  const [workouts, leaderboard] = await Promise.all([getWorkouts(userId), safeLeaderboard()])
  return buildInsights({ workouts, leaderboard, userId, contextWorkoutId: workoutId, max })
}

// Данные домашней сводки (главный экран).
export async function getHomeSummary(userId) {
  const [workouts, goals] = await Promise.all([getWorkouts(userId), readGoals(userId)])
  return buildHomeSummary({ workouts, goals })
}

// Свежесть по группам (детальный экран + тизер Главной): recovery-список
// (когда снова тренировать) + дисбаланс. Всё из локальных тренировок, офлайн.
export async function getFreshness(userId) {
  const workouts = await getWorkouts(userId)
  return {
    recovery: groupFreshness(workouts),
    imbalance: computeImbalance(workouts),
  }
}
