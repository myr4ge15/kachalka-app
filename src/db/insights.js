// ============================================================================
// Инсайты и домашняя сводка — слой БД (виши BACKLOG «✨ Инсайты» / «Домашняя
// сводка»). Читает уже локальные данные (Dexie) и кормит их чистым движкам
// (src/lib/insights.js, src/lib/homeSummary.js). Схему/синк не трогаем.
//
// Все считается из имеющегося: свои тренировки (db.workouts), кэш ленты (db.feed —
// не нужен движку напрямую, но лидерборд для «обгона» берем из кэша), цели (meta),
// снимок лидерборда (getCachedLeaderboard). Сеть не требуется — офлайн-доступно.
// ============================================================================
import { getWorkouts, getCachedUser } from './repo.js'
import { getCachedLeaderboard } from './leaderboard.js'
import { readGoals } from './notifications.js'
import { buildInsights } from '../lib/insights.js'
import { buildHomeSummary } from '../lib/homeSummary.js'
import {
  groupFreshness,
  imbalance as computeImbalance,
  submuscleFreshness,
  submuscleImbalance,
} from '../lib/freshness.js'

// Снимок лидерборда без падений (для «обгона друга»). Пусто/ошибка → null.
async function safeLeaderboard() {
  try {
    return await getCachedLeaderboard()
  } catch {
    return null
  }
}

// Все данные Главной ОДНИМ чтением истории: сводка + инсайты + свежесть. Раньше
// экран держал три отдельных useLiveQuery (getHomeSummary/getInsights/getFreshness),
// и каждый заново читал и сортировал ВСЮ историю тренировок (+ кэш лидерборда
// дважды). Теперь один проход: workouts/лидерборд/цели читаются по одному разу, а
// три чистых движка считают из общего окна. contextWorkoutId движку инсайтов на
// Главной не нужен (контекст — самая свежая тренировка по умолчанию).
// Пол пользователя из ростера — для рода глаголов в текстах (v6.2.5). Ошибка → null.
export async function mySex(userId) {
  try { return (await getCachedUser(userId))?.sex ?? null } catch { return null }
}

export async function getHomeData(userId, { max = 3 } = {}) {
  const [workouts, leaderboard, goals, sex] = await Promise.all([
    getWorkouts(userId),
    safeLeaderboard(),
    readGoals(userId),
    mySex(userId),
  ])
  return {
    sex,
    summary: buildHomeSummary({ workouts, goals }),
    insights: buildInsights({ workouts, leaderboard, userId, max, sex }),
    freshness: {
      recovery: groupFreshness(workouts),
      imbalance: computeImbalance(workouts),
      recoverySub: submuscleFreshness(workouts),
      imbalanceSub: submuscleImbalance(workouts),
    },
  }
}

// Инсайты именно этой (только что сохраненной) тренировки — для тоста после
// сохранения. leaderboard тоже тянем, чтобы «обгон» мог всплыть сразу.
export async function detectInsightsOnSave(userId, workoutId, { max = 3 } = {}) {
  const [workouts, leaderboard, sex] = await Promise.all([getWorkouts(userId), safeLeaderboard(), mySex(userId)])
  return buildInsights({ workouts, leaderboard, userId, contextWorkoutId: workoutId, max, sex })
}

// Свежесть по группам (детальный экран + тизер Главной): recovery-список
// (когда снова тренировать) + дисбаланс. Все из локальных тренировок, офлайн.
export async function getFreshness(userId) {
  const [workouts, sex] = await Promise.all([getWorkouts(userId), mySex(userId)])
  return {
    sex,
    // major-уровень — тизер Главной + heatmap-силуэт (MuscleMap пока по группам)
    recovery: groupFreshness(workouts),
    imbalance: computeImbalance(workouts),
    // submuscle-уровень (слайс 3a) — recovery-список и дисбаланс детального экрана
    recoverySub: submuscleFreshness(workouts),
    imbalanceSub: submuscleImbalance(workouts),
  }
}
