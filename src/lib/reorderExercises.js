import { reorderById } from './reorderById.js'

// Move the whole entry, preserving sets, recommendation and stable exercise ID.
export function reorderExercises(entries, id, beforeId) {
  return reorderById(entries, id, beforeId, e => e.exercise.id)
}
