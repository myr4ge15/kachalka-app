// ============================================================================
// Сводная статистика профиля (ЛК, фаза 2a) — чистые функции БЕЗ Dexie/сети.
//
// На вход — массив денормализованных документов тренировок (как из repo.js
// getWorkouts). На выходе — готовые к показу агрегаты. Никакого IndexedDB,
// поэтому всё тестируется в node.
//
// Разграничение с «Прогрессом»: тут только КРОСС-упражненческие цифры «обо мне
// в целом» (всего тренировок, стрик недель, за месяц) и витрина рекордов по
// ВСЕМ упражнениям сразу. Пер-упражненческая динамика во времени — в «Прогрессе».
//
// Рекорд = максимальный ФАКТИЧЕСКИЙ вес (как в ленте/лидерборде/уведомлениях) —
// переиспользуем myBestByExercise/bestWeight из records.js, формулу не дублируем.
// ============================================================================
import { myBestByExercise, bestWeight } from './records.js'

const entryExId = (e) => e.exercise_id ?? e.exercise?.id ?? null

// Понедельник недели (локально), как объект Date на 00:00.
function mondayOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // Пн=0 … Вс=6
  d.setDate(d.getDate() - dow)
  return d
}

// YYYY-MM-DD по ЛОКАЛЬНЫМ компонентам (без сдвига часового пояса toISOString).
function localYmd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Сколько недель подряд (по ISO-неделям, Пн–Вс) была ≥1 тренировка, считая до
// сегодня. Грейс на текущую неделю: если на этой неделе ещё не тренировался,
// стартуем с прошлой — стрик «жив», пока ходил на прошлой неделе. Первый пропуск
// обрывает счёт.
export function weeklyStreak(workouts) {
  const weeks = new Set()
  for (const w of workouts ?? []) {
    if (!w.performed_at) continue
    weeks.add(localYmd(mondayOf(new Date(w.performed_at))))
  }
  if (weeks.size === 0) return 0
  let cur = mondayOf(new Date())
  if (!weeks.has(localYmd(cur))) cur.setDate(cur.getDate() - 7) // грейс на текущую неделю
  let streak = 0
  while (weeks.has(localYmd(cur))) {
    streak++
    cur.setDate(cur.getDate() - 7)
  }
  return streak
}

// Число тренировок в текущем КАЛЕНДАРНОМ месяце (по дате тренировки).
export function workoutsThisMonth(workouts) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  let n = 0
  for (const w of workouts ?? []) {
    if (!w.performed_at) continue
    const d = new Date(w.performed_at)
    if (d.getFullYear() === y && d.getMonth() === m) n++
  }
  return n
}

// Личные рекорды по ВСЕМ весовым упражнениям: [{ exId, name, weight, isBench }],
// жим лёжа сверху, далее по убыванию веса. Упражнения без веса в рекорды не
// попадают (как и в minePrs/лидерборде).
export function personalRecords(workouts) {
  const best = myBestByExercise(workouts) // Map(exId → { weight, name })
  const bench = new Set()
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (exId && e.exercise?.is_bench_lift) bench.add(exId)
    }
  }
  return [...best.entries()]
    .map(([exId, v]) => ({
      exId,
      name: v.name ?? '—',
      weight: v.weight,
      isBench: bench.has(exId),
    }))
    .sort(
      (a, b) =>
        Number(b.isBench) - Number(a.isBench) ||
        b.weight - a.weight ||
        String(a.name).localeCompare(String(b.name), 'ru')
    )
}

// Любимое упражнение = с наибольшим числом подходов за всю историю.
// { exId, name, sets } или null, если подходов нет.
export function favExercise(workouts) {
  const byId = new Map() // exId → { exId, name, sets }
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const cnt = (e.sets ?? []).length
      if (cnt === 0) continue
      const rec = byId.get(exId) ?? { exId, name: e.exercise?.name ?? '—', sets: 0 }
      rec.sets += cnt
      if (e.exercise?.name) rec.name = e.exercise.name
      byId.set(exId, rec)
    }
  }
  let top = null
  for (const rec of byId.values()) {
    if (!top || rec.sets > top.sets) top = rec
  }
  return top
}

// Полная сводка профиля. Пустая история → нули/[]/null, без падений.
export function summarize(workouts) {
  const list = workouts ?? []
  return {
    totalWorkouts: list.length,
    workoutsThisMonth: workoutsThisMonth(list),
    weeklyStreak: weeklyStreak(list),
    personalRecords: personalRecords(list),
    favExercise: favExercise(list),
  }
}

// Текущий лучший фактический вес по упражнению (для прогресс-бара цели).
// 0, если такого упражнения/веса в истории нет.
export function currentBest(workouts, exerciseId) {
  if (!exerciseId) return 0
  let best = 0
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      if (entryExId(e) !== exerciseId) continue
      best = Math.max(best, bestWeight(e.sets))
    }
  }
  return best
}

// Процент достижения цели (0..100), безопасно при target ≤ 0.
export function goalProgress(current, target) {
  const t = Number(target) || 0
  if (t <= 0) return 0
  return Math.min(100, Math.round(((Number(current) || 0) / t) * 100))
}
