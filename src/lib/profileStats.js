// ============================================================================
// Сводная статистика профиля (ЛК, фаза 2a) — чистые функции БЕЗ Dexie/сети.
//
// На вход — массив денормализованных документов тренировок (как из repo.js
// getWorkouts). На выходе — готовые к показу агрегаты. Никакого IndexedDB,
// поэтому всё тестируется в node.
//
// Разграничение с «Прогрессом»: тут только КРОСС-упражненческие цифры «обо мне
// в целом» (всего тренировок, за месяц) и витрина рекордов по ВСЕМ упражнениям
// сразу. Пер-упражненческая динамика во времени — в «Прогрессе».
//
// Рекорд = лучший ВЕДУЩИЙ показатель упражнения (вес / повторы / секунды — как в
// ленте/лидерборде/уведомлениях) — переиспользуем myBestByExercise/bestWeight из
// records.js, формулу не дублируем.
// ============================================================================
import { myBestByExercise, bestWeight } from './records.js'
import { isCountMetric, leadingValue, normMetric } from './metric.js'

const entryExId = (e) => e.exercise_id ?? e.exercise?.id ?? null

// Число тренировок в текущем КАЛЕНДАРНОМ месяце (по дате тренировки).
// TZ — намеренно ЛОКАЛЬНАЯ: дата выбирается пользователем как локальный день
// (WorkoutScreen.fromDateInput: local setFullYear → ISO), и отображается везде
// тоже локально (toLocaleDateString/fmtWhen). Считать месяц в UTC значило бы
// разойтись с днём, который видит пользователь (ревью 30.06 #8 — проверено,
// не баг: «по той же зоне, что хранение» = по той же зоне, что показ = local).
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

// Личные рекорды по ВСЕМ упражнениям: [{ exId, name, value, metric, isBench }],
// жим лёжа сверху, далее весовые (по убыванию веса), затем не-весовые (повторы/
// время). Значение форматируется в UI через fmtMetricValue по metric.
export function personalRecords(workouts) {
  const best = myBestByExercise(workouts) // Map(exId → { value, metric, name })
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
      value: v.value,
      metric: v.metric,
      isBench: bench.has(exId),
    }))
    .sort(
      (a, b) =>
        Number(b.isBench) - Number(a.isBench) ||
        // весовые выше не-весовых (их значения в разных единицах — не сравниваем
        // напрямую), внутри группы — по убыванию значения, затем по имени.
        Number(isCountMetric(a.metric)) - Number(isCountMetric(b.metric)) ||
        b.value - a.value ||
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
    personalRecords: personalRecords(list),
    favExercise: favExercise(list),
  }
}

// Текущий лучший фактический вес по упражнению (для прогресс-бара ВЕСОВОЙ цели).
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

// Текущий лучший ВЕДУЩИЙ показатель по метрике упражнения (для прогресс-бара
// цели любой метрики): weight → макс. вес, reps → макс. повторов, time → макс.
// секунд. 0, если упражнения/подходов в истории нет.
export function currentBestValue(workouts, exerciseId, metric) {
  if (!exerciseId) return 0
  const m = normMetric(metric)
  let best = 0
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      if (entryExId(e) !== exerciseId) continue
      best = Math.max(best, leadingValue(m, e.sets))
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
