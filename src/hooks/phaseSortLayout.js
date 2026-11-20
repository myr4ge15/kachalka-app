import { phaseOf, reorderWithPhase } from '../lib/workoutPhases.js'

// Только визуальный порядок. Узел ручки остается в DOM до touchend,
// а в черновик перестановка попадает один раз, при отпускании.
export function createPhaseSortLayout(root, rows, idOf) {
  const headings = [...root.querySelectorAll('[data-sort-phase]')]
  if (!headings.length) return null
  let phase = 'main'
  const entries = rows.map(row => {
    phase = row.previousElementSibling?.dataset.sortPhase ?? phase
    return { id: idOf(row), phase, row }
  })
  const keyOf = entry => entry.id
  function reset() {
    for (const row of rows) row.style.order = ''
    for (const heading of headings) {
      heading.style.order = ''
      heading.hidden = false
    }
  }
  function preview(id, beforeId) {
    if (beforeId === undefined) return reset()
    const ordered = reorderWithPhase(entries, id, beforeId, keyOf)
    const firstInPhase = new Map()
    ordered.forEach((entry, index) => {
      const phase = phaseOf(entry)
      if (!firstInPhase.has(phase)) firstInPhase.set(phase, index)
      entry.row.style.order = String(2 * index + 1)
    })
    for (const heading of headings) {
      const index = firstInPhase.get(heading.dataset.sortPhase)
      heading.hidden = index === undefined || (firstInPhase.size === 1 && firstInPhase.has('main'))
      if (!heading.hidden) heading.style.order = String(2 * index)
    }
  }
  return { preview, reset }
}
