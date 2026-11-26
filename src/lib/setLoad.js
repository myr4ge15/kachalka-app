// weight остаётся в килограммах для статистики, исходное показание — для дневника.
export const LB_KG = 0.45359237
export const loadUnit = (set) => set?.load_input?.unit ?? 'kg'
export const loadValue = (set) => set?.load_input?.value ?? set?.weight
export const loadLimit = (unit) => unit === 'lb' ? Math.floor(1000 / LB_KG * 100) / 100 : 1000

export function withLoad(set, unit, value) {
  const next = { ...set }
  if (unit === 'kg') {
    delete next.load_input
    next.weight = value
  } else {
    next.load_input = { unit, value }
    next.weight = unit === 'lb' ? Math.round(Number(value) * LB_KG * 100) / 100 : 0
  }
  return next
}

export function storedSet(s) {
  return { weight: Number(s.weight), reps: Number(s.reps), ...(s.load_input && { load_input: s.load_input }) }
}

// Сравниваем подходы одного человека при одинаковом номере блока либо
// одинаковом числе повторов. Изменение сразу обеих величин не ранжируем.
export function personalLoadGain(sets, previous) {
  let best = null
  for (const [index, set] of (sets ?? []).entries()) {
    const unit = loadUnit(set)
    if (unit === 'kg') continue
    const peers = (previous ?? []).filter(s => loadUnit(s) === unit)
    const same = peers.filter(s => unit === 'block' ? loadValue(s) === loadValue(set) : s.reps === set.reps)
    const value = s => unit === 'block' ? s.reps : loadValue(s)
    if (!same.length) continue
    const before = same.reduce((a, b) => value(a) > value(b) ? a : b)
    const delta = Math.round((value(set) - value(before)) * 100) / 100
    if (delta > 0 && (!best || delta > best.delta)) best = { index, delta }
  }
  return best
}
