// Move the whole entry, preserving sets, recommendation and stable exercise ID.
export function reorderExercises(entries, id, beforeId) {
  const entry = entries.find(e => e.exercise.id === id)
  if (!entry || id === beforeId) return entries
  const rest = entries.filter(e => e !== entry)
  const to = beforeId === null ? rest.length : rest.findIndex(e => e.exercise.id === beforeId)
  if (to < 0) return entries
  rest.splice(to, 0, entry)
  return rest.every((e, i) => e === entries[i]) ? entries : rest
}
