// ============================================================================
// Чистая логика рекордов и уведомлений (без Dexie/сети) — ТЗ §4.5, MVP.
//
// Здесь только вычисления над уже денормализованными `entries`. Слой БД
// (src/db/notifications.js) читает данные и кормит их сюда. Так алгоритмы
// тестируются в node без IndexedDB, а схему/синк трогать не нужно.
//
// Рекорд = лучший ВЕДУЩИЙ показатель упражнения (PLAN-metrics): для весовых —
// максимальный фактический вес подхода (как в ленте/лидерборде), для упражнений
// своего веса/на время — максимум повторов/секунд за подход. НЕ расчетный 1ПМ.
// Первый замер по упражнению рекордом не считаем — нечего бить (согласовано с
// computePrs в db/feed.js).
// ============================================================================
import { cmpIsoAsc } from './cmp.js'
import { leadingValue, normMetric } from './metric.js'
import { entryExId, entryMetric, currentExerciseShapes, entryUnitMetric, isCurrentUnit } from './entries.js'

// Максимальный фактический вес среди подходов [{weight, reps}]. Оставлен для
// весо-специфичных мест (цели в кг — profileStats.currentBest).
export function bestWeight(sets) {
  return (sets ?? []).reduce((m, s) => Math.max(m, Number(s.weight) || 0), 0)
}

// Имя записи оставлено по месту: у records дефолт null (у ленты/insights — '—').
const entryName = (e) => e.name ?? e.exercise?.name ?? null

// Лучший ведущий показатель по каждому упражнению за переданную историю.
// Возвращает Map(exercise_id → { value, metric, name }).
// Метрика и имя — из САМОГО СВЕЖЕГО снимка упражнения, в максимум идут только
// подходы в этой же единице (РЕВЬЮ-КОДА-2026-10-02, п. 17: после смены типа
// старые килограммы иначе становились «рекордом» в повторах).
export function myBestByExercise(workouts) {
  const shapes = currentExerciseShapes(workouts)
  const best = new Map()
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const shape = shapes.get(exId)
      if (!isCurrentUnit(e, shape)) continue
      const metric = shape?.metric ?? entryMetric(e)
      const value = leadingValue(metric, e.sets)
      if (value <= 0) continue
      const prev = best.get(exId)
      if (!prev || value > prev.value) {
        best.set(exId, { value, metric, name: shape?.name ?? entryName(e) ?? prev?.name ?? '—' })
      }
    }
  }
  return best
}

// «У тебя новый рекорд»: идем по своим тренировкам в хронологическом порядке и
// для каждого упражнения ловим момент, когда ведущий показатель превысил прежний
// максимум. Возвращает [{ id, type:'mine', exId, name, metric, value, prev, at }].
// Максимум ведем ОТДЕЛЬНО по каждой единице (exId + метрика записи): рекорд в кг,
// поставленный до смены типа, остается настоящим событием истории, но 12 повторов
// не «бьют» старые 10 кг, а первый вес после reps→weight — не рекорд, а первый
// замер (РЕВЬЮ-КОДА-2026-10-02, п. 17). Имя — из свежего снимка (переименование).
export function minePrs(workouts) {
  const shapes = currentExerciseShapes(workouts)
  const best = new Map() // `${exId}:${metric}` → value
  const out = []
  // Тай-брейк: при равных performed_at (импорт, два сохранения в одну секунду)
  // порядок массива недетерминирован → PR/prev мог приписаться не той тренировке.
  // Дотягиваем хронологию по created_at, затем по id (стабильно и без локали).
  const chron = [...(workouts ?? [])].sort(
    (a, b) =>
      cmpIsoAsc(a.performed_at, b.performed_at) ||
      cmpIsoAsc(a.created_at, b.created_at) ||
      cmpIsoAsc(String(a.id), String(b.id))
  )
  for (const w of chron) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const shape = shapes.get(exId)
      const metric = entryUnitMetric(e, shape?.metric)
      const value = leadingValue(metric, e.sets)
      if (value <= 0) continue
      const key = `${exId}:${metric}`
      const prev = best.get(key) ?? 0
      if (value > prev) {
        if (prev > 0) {
          out.push({
            id: `mine:${w.id}:${exId}`,
            type: 'mine',
            exId,
            name: shape?.name ?? entryName(e) ?? '—',
            metric,
            value,
            prev,
            at: w.performed_at,
          })
        }
        best.set(key, value)
      }
    }
  }
  return out
}

// «Друг побил твой рекорд»: по элементам ленты (тренировки всех) в хронологии.
// Событие — именно ПЕРЕХОД друга через мой рекорд: в окне ленты он был не выше
// меня, а стал выше. Для каждой пары (друг, упражнение) ведем его максимум в
// окне; первое появление упражнения у друга — только базис, не событие.
//
// ⚠️ Почему так (v5.14.2). Раньше планка стартовала прямо с моего рекорда, а
// окно ленты — это последние FEED_LIMIT=50 тренировок ВСЕХ участников, то есть
// на пятерых всего ~3–4 недели. Когда старая тренировка друга выпадала из окна,
// планка сбрасывалась на мой рекорд, и ближайший его подход — давно привычный,
// без всякого прогресса — снова «побивал» меня. Уведомление «Сегалодон обошел
// тебя: 90 (твой 77.5)» приходило по кругу примерно раз в месяц. Базис из окна
// это снимает: пока друг стабильно выше меня, событий нет.
//
// Плата за отказ от хранения состояния: если друг впервые за 4 недели взялся за
// упражнение и сразу ушел выше меня, перехода в окне не видно и уведомления не
// будет. Тот же слепой угол, что у отметок рекордов в ленте (feed.computePrs), —
// осознанно, чтобы не заводить новую синкаемую сущность в meta ради дедупа.
//
// Свои тренировки исключаем по userId. myBest — Map(exId → { value, metric,
// name }) из myBestByExercise. Возвращает
// [{ id, type:'beaten', exId, name, who, metric, value, myValue, at }].
export function computeBeaten(feedItems, userId, myBest) {
  const chron = [...(feedItems ?? [])]
    .filter((it) => it.user_id !== userId)
    .sort(
      (a, b) =>
        cmpIsoAsc(a.performed_at, b.performed_at) ||
        cmpIsoAsc(a.created_at, b.created_at) ||
        cmpIsoAsc(String(a.id), String(b.id))
    )
  const seen = new Map() // `${friend}:${exId}` → его максимум в окне (undefined — еще не видели)
  const out = []
  for (const it of chron) {
    for (const e of it.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const mine = myBest.get(exId)
      if (!mine || mine.value <= 0) continue // нет своего рекорда — нечего бить
      const metric = mine.metric // сравниваем по метрике упражнения (одна на всех)
      // Запись друга в другой единице (кэш ленты со старым снимком после смены
      // типа) с моим рекордом несравнима (РЕВЬЮ-КОДА-2026-10-02, п. 17).
      if (entryUnitMetric(e, metric) !== metric) continue
      const value = leadingValue(metric, e.sets)
      if (value <= 0) continue
      const key = `${it.user_id}:${exId}`
      const prev = seen.get(key)
      // Первое появление упражнения у этого друга в окне — базис. Мы не знаем,
      // что было до окна, поэтому «обошел» здесь недоказуемо.
      if (prev === undefined) {
        seen.set(key, value)
        continue
      }
      seen.set(key, Math.max(prev, value))
      // Переход: был не выше меня — стал выше. Друг, который и так впереди,
      // событий больше не порождает, сколько бы он ни улучшался.
      if (prev <= mine.value && value > mine.value) {
        out.push({
          id: `beaten:${it.id}:${exId}`,
          type: 'beaten',
          exId,
          name: entryName(e) ?? mine.name ?? '—',
          who: it.user_name ?? 'Друг',
          whoId: it.user_id, // для рода глагола по полу (v6.2.5)
          metric,
          value,
          myValue: mine.value,
          at: it.performed_at,
        })
      }
    }
  }
  return out
}

// Пересекла ли цель порог именно сейчас: прежний лучший вес был НИЖЕ цели, а
// текущий стал ≥ цели. Момент достижения ловим один раз (как рекорд). target ≤ 0
// или отсутствие цели → не событие. Цели — только весовые (кг), см. PLAN-metrics.
export function crossedGoal(prevBest, curBest, target) {
  const t = Number(target) || 0
  if (t <= 0) return false
  return (Number(prevBest) || 0) < t && (Number(curBest) || 0) >= t
}

// Цель «вес × повторы» (PLAN-goal-reps): есть ли среди подходов ХОТЯ БЫ ОДИН, где
// weight ≥ targetWeight И reps ≥ targetReps. Нужен ОДИН подход на оба условия —
// повторы из разных подходов не «склеиваются». targetReps пуст/0 → требование по
// повторам снимается (только вес, старое поведение). Только для весовых целей.
export function hasSetMeetingGoal(sets, targetWeight, targetReps) {
  const w = Number(targetWeight) || 0
  if (w <= 0) return false
  const r = Number(targetReps) || 0
  return (sets ?? []).some(
    (s) => (Number(s.weight) || 0) >= w && (r <= 0 || (Number(s.reps) || 0) >= r)
  )
}

// Достигнута ли весовая цель «вес × повторы» хотя бы одним подходом за всю
// переданную историю по упражнению exerciseId. Перебираем подходы (а не агрегат
// по весу), потому что условие двойное и должно выполняться в одном подходе.
export function goalMetByExercise(workouts, exerciseId, targetWeight, targetReps) {
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      if (entryExId(e) !== exerciseId) continue
      if (hasSetMeetingGoal(e.sets, targetWeight, targetReps)) return true
    }
  }
  return false
}

// Новые личные рекорды ИМЕННО этой тренировки (для тоста после сохранения).
// savedEntries — entries сохраненной тренировки; othersBest — лучшее по ВСЕМ
// ОСТАЛЬНЫМ моим тренировкам (Map exId → { value, metric }). Считаем рекордом
// только превышение прежнего максимума (prev > 0), как и в minePrs. Возвращает
// [{ exerciseId, name, metric, value, prev }].
export function computeNewPrs(savedEntries, othersBest) {
  const out = []
  for (const e of savedEntries ?? []) {
    const exId = entryExId(e)
    if (!exId) continue
    const metric = entryMetric(e)
    const value = leadingValue(metric, e.sets)
    if (value <= 0) continue
    // Прежний максимум в ДРУГОЙ единице (тип упражнения сменили) — не база для
    // рекорда: первая тренировка в новой единице — первый замер, а не «12 повт.
    // (было 10 кг)» (РЕВЬЮ-КОДА-2026-10-02, п. 17).
    const other = othersBest.get(exId)
    const prev = other && normMetric(other.metric) === metric ? other.value ?? 0 : 0
    if (prev > 0 && value > prev) {
      out.push({ exerciseId: exId, name: entryName(e) ?? '—', metric, value, prev })
    }
  }
  return out
}
