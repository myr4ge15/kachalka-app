import { exerciseMetric, fmtSet } from './metric.js'
import { pluralize } from './plural.js'
import { exerciseCompletion } from './setCompletion.js'

// Сколько групп подходов помещается в однострочную сводку компактной карточки
// (11px, `text-overflow: ellipsis` на 390px). Хвост длиннее — «…».
const SUMMARY_MAX_GROUPS = 4

function blankOrNonPositive(value) {
  if (value === '' || value == null) return true
  const n = Number(value)
  return !Number.isFinite(n) || n <= 0
}

// «Незаполненное» упражнение для стартового фокуса при редактировании:
// нет подходов, нет ведущего значения или у весовой метрики не указан вес.
// Для reps/time weight=0 — штатный формат, поэтому проверяем только reps.
export function isExerciseIncomplete(entry) {
  if (!entry?.sets?.length) return true
  const weighted = exerciseMetric(entry.exercise) === 'weight'
  return entry.sets.some((set) => (
    blankOrNonPositive(set?.reps) ||
    (weighted && blankOrNonPositive(set?.weight))
  ))
}

// Стабильный id важнее индекса: состав можно удалять, заменять и дополнять
// шаблоном, не переводя фокус на случайную соседнюю карточку.
export function pickActiveExerciseId(entries, currentId, { preferIncomplete = false } = {}) {
  const list = entries ?? []
  if (currentId && list.some((entry) => entry?.exercise?.id === currentId)) return currentId

  const preferred = preferIncomplete
    ? list.find((entry) => isExerciseIncomplete(entry))
    : null
  return preferred?.exercise?.id ?? list[0]?.exercise?.id ?? null
}

// Заявка фокуса на явное действие пользователя: `{ id, revision }`, где рост
// revision — единственный триггер reveal-скролла (центрирования карточки).
//
// Ключевое: активная карточка выбирается АВТОМАТИЧЕСКИ (`pickActiveExerciseId`),
// пока заявки нет (`request.id === null`), поэтому первый же тап внутри неё —
// по инпуту, степперу, отметке подхода — приходил как «смена фокуса» и уводил
// экран в центр ПОД ПАЛЬЦЕМ. Плавная прокрутка длится доли секунды, следующий тап
// попадал в съехавшую соседнюю строку и снимал отметку не с того подхода.
// Поэтому: заявку фиксируем (иначе выбор продолжит «плыть» за составом), но
// revision растёт ТОЛЬКО когда фокус реально переходит на другое упражнение.
export function nextFocusRequest(request, exerciseId, activeExerciseId) {
  const id = exerciseId ?? null
  if (request.id === id) return request
  const switching = id !== null && id !== activeExerciseId
  return { id, revision: switching ? request.revision + 1 : request.revision }
}

// Подход считается незаполненным по ведущему числу: у 'weight' это повторы, у
// 'reps'/'time' — сами повторы/секунды. Оба случая живут в `reps`.
function unfilledSet(set) {
  return !(Number(set?.reps) > 0)
}

// Перечисление подходов для свёрнутой карточки. Раньше здесь показывался ЛУЧШИЙ
// подход, и «3 подхода · 45×10» читалось как «все три по 45×10», хотя подходы
// могли быть разными (пирамида, дроп-сет). Поэтому перечисляем фактические
// подходы по порядку, схлопывая одинаковые ПОДРЯД идущие в «45×10 ×3» —
// типовой случай «три одинаковых» остаётся такой же короткой строкой.
// Незаполненный подход показываем как «—», чтобы пропуск был виден.
export function setsSummaryText(metric, sets) {
  const groups = []
  for (const set of sets ?? []) {
    const text = unfilledSet(set) ? '—' : fmtSet(metric, set)
    const last = groups[groups.length - 1]
    if (last && last.text === text) last.n += 1
    else groups.push({ text, n: 1 })
  }
  const shown = groups
    .slice(0, SUMMARY_MAX_GROUPS)
    .map((g) => (g.n > 1 ? `${g.text} ×${g.n}` : g.text))
  if (groups.length > SUMMARY_MAX_GROUPS) shown.push('…')
  return shown.join(' · ')
}

// Данные компактной карточки: нейтральная сводка введённых значений плюс — если
// пользователь ЯВНО отмечал подходы — прогресс выполнения (Slice 2). Сама по себе
// заполненность значений статусом не считается: подходы предзаполняют шаблон и
// автопрогрессия. `doneKeys` — множество ключей из lib/setCompletion.js.
export function exerciseFocusSummary(entry, doneKeys = null) {
  const sets = entry?.sets ?? []
  const metric = exerciseMetric(entry?.exercise)
  const setLabel = pluralize(sets.length, 'подход', 'подхода', 'подходов')
  // Ни одного заполненного подхода — перечислять нечего, остаётся прежняя
  // нейтральная формулировка «значения не указаны».
  const setsText = sets.some((set) => !unfilledSet(set))
    ? setsSummaryText(metric, sets)
    : null
  const { doneCount, allDone } = exerciseCompletion(entry, doneKeys)

  // Статус ведёт строку, значения идут после него: свёрнутая карточка должна
  // отвечать на «сделано или нет» раньше, чем на «что было в подходах».
  // Без единой отметки строка остаётся прежней нейтральной сводкой.
  const parts = []
  if (allDone) parts.push('✓ выполнено', setLabel)
  else if (doneCount > 0) parts.push(`выполнено ${doneCount} из ${sets.length}`)
  else parts.push(setLabel)
  if (setsText) parts.push(setsText)
  else if (doneCount === 0) parts.push('значения не указаны')

  return {
    setCount: sets.length,
    doneCount,
    allDone,
    sets: setsText,
    text: parts.join(' · '),
  }
}
