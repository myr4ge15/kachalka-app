// ============================================================================
// Профиль другого участника (v6.7.0) — чистая логика, БЕЗ Dexie/React/сети.
//
// На вход — элементы ленты (`db/feed.js` rowToItem: плоские entries с
// exercise_id/name/metric/is_bench_lift) по ОДНОМУ участнику, на выход — готовая
// к показу витрина: статы, рекорды, любимое упражнение, последние тренировки.
//
// Сводку не считаем заново: элементы приводим к форме документа тренировки
// (entries[].exercise = {...}) и отдаем в те же функции, что и свой Профиль
// (lib/profileStats.js). Формулы рекорда/серии/любимого — одни на оба экрана.
//
// Окно: с сервера берем не всю историю, а последние MEMBER_LIMIT тренировок
// (вложенный join по всей истории активного участника тяжелый). Поэтому:
// - «тренировок всего» — отдельный точный count с сервера (total), а не длина окна;
// - рекорды при полном окне — «по последним N тренировкам» (windowFull);
// - серия, дошедшая до самой старой тренировки полного окна, — нижняя граница
//   (streakFloor: «N+ нед.»), иначе честное число.
// ============================================================================
import { personalRecords, currentStreak, workoutsThisMonth, favExercise } from './profileStats.js'
import { sortDesc } from './entries.js'

export const MEMBER_LIMIT = 60

// Элемент ленты → денормализованный документ тренировки (как в repo.getWorkouts).
export function toWorkoutDoc(item) {
  return {
    id: item.id,
    user_id: item.user_id,
    performed_at: item.performed_at,
    created_at: item.created_at ?? item.performed_at,
    entries: (item.entries ?? []).map((e) => ({
      exercise_id: e.exercise_id,
      exercise: {
        id: e.exercise_id,
        name: e.name ?? '—',
        muscle_group: e.muscle_group ?? null,
        metric: e.metric,
        is_bench_lift: Boolean(e.is_bench_lift),
      },
      sets: e.sets ?? [],
    })),
  }
}

// Индекс календарной недели (пн) — ТА ЖЕ формула, что weekIndexOf в profileStats
// (там не экспортирована): Date.UTC от локальных Y/M/D, без сдвигов на DST.
function mondayIndex(date) {
  const days = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000)
  return Math.floor((days + 3) / 7)
}

// Витрина профиля участника.
// items — элементы ленты этого участника (любой порядок), total — точное число его
// тренировок с сервера (null → неизвестно, берем длину окна), limit — размер окна.
export function buildMemberView(items, { total = null, limit = MEMBER_LIMIT, now = new Date() } = {}) {
  const recent = sortDesc(items ?? [])
  const docs = recent.map(toWorkoutDoc)
  const windowFull = recent.length >= limit
  const streak = currentStreak(docs, now)

  // Серия упирается в начало окна → дальше истории не видно, это нижняя граница.
  let streakFloor = false
  if (windowFull && streak > 0 && recent.length) {
    const oldest = new Date(recent[recent.length - 1].performed_at)
    const cur = mondayIndex(now)
    const startWeek = (docs.some((w) => mondayIndex(new Date(w.performed_at)) === cur) ? cur : cur - 1) - streak + 1
    streakFloor = mondayIndex(oldest) >= startWeek
  }

  const knownTotal = Number.isFinite(total) && total >= recent.length ? total : recent.length
  return {
    total: knownTotal,
    thisMonth: workoutsThisMonth(docs),
    streak,
    streakFloor,
    records: personalRecords(docs),
    fav: favExercise(docs),
    recent,
    windowFull,
    windowSize: recent.length,
    lastAt: recent[0]?.performed_at ?? null,
  }
}
