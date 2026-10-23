// ============================================================================
// Разминка и заминка — отдельные блоки тренировки (23.10.2026, отзыв Ильи fb_c2774110). Чистая логика.
//
// Упражнение тренировки или шаблона с phase 'warmup' | 'cooldown' стоит в своем блоке: разминка — сверху,
// основная часть (phase нет) — посередине, заминка — снизу. Статистика берет только основную часть
// (lib/entries.js mainEntries). Порядок массива entries и есть порядок блоков: функции здесь его держат.
// ============================================================================

export const PHASES = ['warmup', 'main', 'cooldown']
export const PHASE_LABEL = { warmup: 'Разминка', main: 'Основная часть', cooldown: 'Заминка' }
// Пункты меню упражнения: куда перенести.
export const PHASE_MOVE_LABEL = { warmup: 'В разминку', main: 'В основную часть', cooldown: 'В заминку' }

const RANK = { warmup: 0, main: 1, cooldown: 2 }
export const phaseOf = (e) => (e?.phase === 'warmup' || e?.phase === 'cooldown' ? e.phase : 'main')
// Значение поля для хранения: основная часть — без поля (старые тренировки так и лежат).
export const phaseValue = (phase) => (phase === 'warmup' || phase === 'cooldown' ? phase : undefined)

// Порядок по блокам, внутри блока — как было (устойчиво). Тот же массив, если уже по порядку.
export function orderByPhase(entries) {
  const list = entries ?? []
  const sorted = list.map((e, i) => [e, i]).sort((a, b) => RANK[phaseOf(a[0])] - RANK[phaseOf(b[0])] || a[1] - b[1]).map(([e]) => e)
  return sorted.every((e, i) => e === list[i]) ? list : sorted
}

// Перенести упражнение idx в блок phase — в конец этого блока.
export function setEntryPhase(entries, idx, phase) {
  const list = entries ?? []
  const cur = list[idx]
  if (!cur) return list
  const value = phaseValue(phase)
  if (phaseOf(cur) === phaseOf({ phase: value })) return list
  const moved = { ...cur }
  if (value) moved.phase = value
  else delete moved.phase
  const rest = list.filter((_, i) => i !== idx)
  // Конец блока: после последнего элемента с рангом ≤ нужного.
  let at = 0
  rest.forEach((e, i) => { if (RANK[phaseOf(e)] <= RANK[phaseOf(moved)]) at = i + 1 })
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

// Заголовок блока перед элементом i: только у первого элемента блока и только когда есть разминка или заминка
// (тренировка без них выглядит как раньше). Одна разминка без основной части — тоже с заголовком: иначе после
// переноса не видно, что упражнение ушло в разминку (владелец 23.10).
export function phaseHeading(entries, i) {
  const list = entries ?? []
  const blocks = list.some((e) => phaseOf(e) !== 'main')
  if (!blocks || !list[i]) return null
  const p = phaseOf(list[i])
  return i === 0 || phaseOf(list[i - 1]) !== p ? PHASE_LABEL[p] : null
}

// Перетаскивание (useSortable): упражнение встает перед beforeId и переходит в блок того, рядом с кем легло
// (перед первым разминки — в разминку; в конец — в блок последнего). Порядок блоков сохраняется.
export function reorderWithPhase(entries, id, beforeId, keyOf = (e) => e.exercise.id) {
  const list = entries ?? []
  const item = list.find((x) => keyOf(x) === id)
  if (!item || id === beforeId) return list
  const rest = list.filter((x) => x !== item)
  const to = beforeId === null ? rest.length : rest.findIndex((x) => keyOf(x) === beforeId)
  if (to < 0) return list
  const neighbor = rest[to] ?? rest[to - 1]
  const value = neighbor ? phaseValue(phaseOf(neighbor)) : phaseValue(phaseOf(item))
  let moved = item
  if (phaseOf(item) !== phaseOf({ phase: value })) {
    moved = { ...item }
    if (value) moved.phase = value
    else delete moved.phase
  }
  rest.splice(to, 0, moved)
  const out = orderByPhase(rest)
  return out.every((x, i) => x === list[i]) ? list : out
}
