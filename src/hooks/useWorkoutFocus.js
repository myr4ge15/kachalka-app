import { useCallback, useState } from 'react'
import { pickActiveExerciseId } from '../lib/workoutFocus.js'

// Транзиентное UI-состояние композера: в документ тренировки и Dexie не попадает.
// Возвращаем уже согласованный с актуальным entries id, поэтому удаление активной
// карточки не оставляет потребителей с несуществующим упражнением.
export function useWorkoutFocus(entries, { preferIncomplete = false } = {}) {
  const [requestedId, setRequestedId] = useState(null)
  const activeExerciseId = pickActiveExerciseId(entries, requestedId, { preferIncomplete })
  const activateExercise = useCallback((exerciseId) => {
    setRequestedId(exerciseId ?? null)
  }, [])

  return { activeExerciseId, activateExercise }
}
