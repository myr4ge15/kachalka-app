// ============================================================================
// Теги дня — автосводка групп мышц тренировки (BACKLOG: «Теги дня»).
//
// Тег полностью АВТОМАТИЧЕСКИЙ: считается на лету из денормализованных `entries`
// тренировки (никаких правок схемы Dexie/синка). У каждого упражнения в справочнике
// проставлена `muscle_group`; тег дня — это список уникальных групп всех упражнений
// тренировки. Решение по объёму: «показываем ВСЕ группы подряд» (без порога).
//
// Чистый модуль (без Dexie/React) — тестируется юнит-прогоном.
// ============================================================================

// Канонический порядок групп — как в пикере (ExercisePicker BASE_GROUPS).
// Группы вне списка (нестандартные «свои») идут после канонических, по алфавиту.
export const GROUP_ORDER = ['грудь', 'спина', 'ноги', 'плечи', 'бицепс', 'трицепс', 'пресс']

// Группа → slug для CSS-класса цвета (.day-tag.tag-<slug>). Неизвестные → 'other'.
const GROUP_SLUG = {
  'грудь': 'chest',
  'спина': 'back',
  'ноги': 'legs',
  'плечи': 'shoulders',
  'бицепс': 'biceps',
  'трицепс': 'triceps',
  'пресс': 'abs',
}

// Достаёт группу мышц из записи. Поддерживает оба формата:
//   • «Мои тренировки» (repo): entry.exercise.muscle_group
//   • «Лента» (feed):          entry.muscle_group
function groupOf(entry) {
  return entry?.muscle_group ?? entry?.exercise?.muscle_group ?? null
}

// Сортировка групп: канонические — в порядке GROUP_ORDER, прочие — после, по алфавиту.
function byCanonical(a, b) {
  const ia = GROUP_ORDER.indexOf(a)
  const ib = GROUP_ORDER.indexOf(b)
  if (ia !== -1 && ib !== -1) return ia - ib
  if (ia !== -1) return -1
  if (ib !== -1) return 1
  return a.localeCompare(b, 'ru')
}

// Список тегов дня: уникальные непустые группы мышц всех упражнений тренировки,
// в каноническом порядке. Упражнения без группы (null) просто не дают тега.
export function dayTags(entries) {
  const set = new Set()
  for (const e of entries ?? []) {
    const g = groupOf(e)
    if (g) set.add(g)
  }
  return Array.from(set).sort(byCanonical)
}

// CSS-slug цвета для группы.
export function tagSlug(group) {
  return GROUP_SLUG[group] ?? 'other'
}

// Винительный падеж названия группы — для фраз «тренировать <что?>» / «проработать
// <что?>» (иначе выходит «спина не тренировал»). У большинства групп винительный
// совпадает с именительным (грудь/ноги/плечи/бицепс/трицепс/пресс), отличается
// только «спина» → «спину». Неизвестные группы возвращаем как есть.
const GROUP_ACCUSATIVE = {
  'спина': 'спину',
}
export function groupAccusative(group) {
  return group ? (GROUP_ACCUSATIVE[group] ?? group) : group
}

// Тренировка попадает под фильтр группы (true для пустого/нулевого фильтра — «Все»).
export function matchesGroup(entries, group) {
  if (!group) return true
  return dayTags(entries).includes(group)
}

// Уникальные группы по всему списку тренировок — для строки фильтра
// (показываем только те группы, что реально встречаются у пользователя).
export function availableGroups(workouts) {
  const set = new Set()
  for (const w of workouts ?? []) {
    for (const g of dayTags(w.entries)) set.add(g)
  }
  return Array.from(set).sort(byCanonical)
}
