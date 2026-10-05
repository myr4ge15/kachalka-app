// ============================================================================
// Сводная статистика профиля (ЛК, фаза 2a) — чистые функции БЕЗ Dexie/сети.
//
// На вход — массив денормализованных документов тренировок (как из repo.js
// getWorkouts). На выходе — готовые к показу агрегаты. Никакого IndexedDB,
// поэтому все тестируется в node.
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
import { isCountMetric, leadingValue, normMetric, setTonnage, bestPace } from './metric.js'
import { entryExId, currentExerciseShapes, entryUnitMetric } from './entries.js'

// Число тренировок в текущем КАЛЕНДАРНОМ месяце (по дате тренировки).
// TZ — намеренно ЛОКАЛЬНАЯ: дата выбирается пользователем как локальный день
// (WorkoutScreen.fromDateInput: local setFullYear → ISO), и отображается везде
// тоже локально (toLocaleDateString/fmtWhen). Считать месяц в UTC значило бы
// разойтись с днем, который видит пользователь (ревью 30.06 #8 — проверено,
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
// жим лежа сверху, далее весовые (по убыванию веса), затем не-весовые (повторы/
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
  // Дистанция (v6.12.0): рекорд — самая длинная дистанция, лучший темп (от 1 км) — сноской.
  const paceSets = new Map()
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (!exId || best.get(exId)?.metric !== 'distance') continue
      if (normMetric(e.metric ?? e.exercise?.metric) !== 'distance') continue
      paceSets.set(exId, [...(paceSets.get(exId) ?? []), ...(e.sets ?? [])])
    }
  }
  // Группы единиц: кг → км → повторы/время (разные единицы не сравниваем напрямую).
  const group = (m) => (m === 'distance' ? 1 : isCountMetric(m) ? 2 : 0)
  return [...best.entries()]
    .map(([exId, v]) => ({
      exId,
      name: v.name ?? '—',
      value: v.value,
      metric: v.metric,
      isBench: bench.has(exId),
      ...(v.metric === 'distance' ? { pace: bestPace(paceSets.get(exId)) } : {}),
    }))
    .sort(
      (a, b) =>
        Number(b.isBench) - Number(a.isBench) ||
        // весовые выше не-весовых (их значения в разных единицах — не сравниваем
        // напрямую), внутри группы — по убыванию значения, затем по имени.
        group(a.metric) - group(b.metric) ||
        b.value - a.value ||
        String(a.name).localeCompare(String(b.name), 'ru')
    )
}

// Индекс НЕДЕЛИ (Monday-based, ЛОКАЛЬНО) для даты. Считаем через Date.UTC от
// ЛОКАЛЬНЫХ компонентов Y/M/D — так на любой TZ получаем ровно целое число дней
// от эпохи без дробей/сдвигов (день тренировки везде трактуется как локальный,
// см. workoutsThisMonth). +3 сдвигает так, что неделя начинается с понедельника
// (эпоха, 1970-01-01, — четверг).
function weekIndexOf(date) {
  const days = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  )
  return Math.floor((days + 3) / 7)
}

// Текущая серия: сколько КАЛЕНДАРНЫХ недель подряд (по понедельникам) есть хотя
// бы одна тренировка, считая до текущей недели включительно. Грейс в одну неделю:
// если на этой неделе еще не тренировался, серия не рвется — считаем от прошлой
// недели (иначе счетчик обнулялся бы каждый понедельник до первой тренировки).
// Нет активности ни на этой, ни на прошлой неделе → 0. now инъектируется в тестах.
export function currentStreak(workouts, now = new Date()) {
  const weeks = new Set()
  for (const w of workouts ?? []) {
    if (!w.performed_at) continue
    weeks.add(weekIndexOf(new Date(w.performed_at)))
  }
  if (weeks.size === 0) return 0
  const cur = weekIndexOf(now)
  let wk
  if (weeks.has(cur)) wk = cur
  else if (weeks.has(cur - 1)) wk = cur - 1
  else return 0
  let n = 0
  while (weeks.has(wk)) { n++; wk-- }
  return n
}

// Суммарный тоннаж за всю историю: Σ (вес × повторы) по всем подходам. Считаем
// только подходы С весом (weight>0 и reps>0) — упражнения своего веса/на время
// (weight:0, reps=повторы/секунды) внешней нагрузки не несут и в тоннаж не идут.
export function totalTonnage(workouts) {
  let kg = 0
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      for (const s of e.sets ?? []) {
        kg += setTonnage(normMetric(e.metric ?? e.exercise?.metric), s) // км дистанции — не кг
      }
    }
  }
  return kg
}

// Формат тоннажа для витрины: до тонны — в кг, дальше — в тоннах (1 знак до 100 т,
// потом целое). Возвращает { value, unit } под .stat-num + .u.
export function fmtTonnage(kg) {
  const n = Number(kg) || 0
  if (n < 1000) return { value: String(Math.round(n)), unit: 'кг' }
  const t = n / 1000
  return { value: t >= 100 ? String(Math.round(t)) : String(Math.round(t * 10) / 10), unit: 'т' }
}

// Любимое упражнение = с наибольшим числом подходов за всю историю.
// { exId, name, sets } или null, если подходов нет.
export function favExercise(workouts) {
  // Имя — из свежего снимка: переименованное упражнение в старых тренировках
  // хранит старое имя (РЕВЬЮ-КОДА-2026-10-02, п. 17).
  const shapes = currentExerciseShapes(workouts)
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
      if (shapes.get(exId)?.name) rec.name = shapes.get(exId).name
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
    streak: currentStreak(list),
    tonnage: totalTonnage(list),
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
      // Подходы, записанные, когда упражнение было на повторы/время, — не кг.
      if (entryUnitMetric(e, 'weight') !== 'weight') continue
      best = Math.max(best, bestWeight(e.sets))
    }
  }
  return best
}

// Текущий лучший ВЕДУЩИЙ показатель по метрике упражнения (для прогресс-бара
// цели любой метрики): weight → макс. вес, reps → макс. повторов, time → макс.
// секунд. 0, если упражнения/подходов в истории нет.
// Учитываем только записи В ЕДИНИЦЕ ЦЕЛИ: после смены типа упражнения старые
// снимки в тренировках не обновляются, и leadingValue('reps') от «10 кг × 8»
// подмешивал бы 8 повторов к цели на повторы (РЕВЬЮ-КОДА-2026-10-02, п. 17).
export function currentBestValue(workouts, exerciseId, metric) {
  if (!exerciseId) return 0
  const m = normMetric(metric)
  let best = 0
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      if (entryExId(e) !== exerciseId) continue
      if (entryUnitMetric(e, m) !== m) continue
      best = Math.max(best, leadingValue(m, e.sets))
    }
  }
  return best
}

// Процент достижения цели (0..100), безопасно при target ≤ 0. 100 — ТОЛЬКО когда
// значение действительно дошло до цели: округление вверх показывало «100 %» и
// «целевой вес взят» при 99,5 из 100. До цели — вниз и не выше 99.
export function goalProgress(current, target) {
  const t = Number(target) || 0
  if (t <= 0) return 0
  const c = Number(current) || 0
  if (c >= t) return 100
  return Math.max(0, Math.min(99, Math.floor((c / t) * 100)))
}
