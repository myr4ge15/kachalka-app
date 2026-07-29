import { useCallback, useState } from 'react'
import { pickActiveExerciseId } from '../lib/workoutFocus.js'
import { useRevealFocus } from './useRevealFocus.js'

// Транзиентное UI-состояние композера: в документ тренировки и Dexie не попадает.
// Возвращаем уже согласованный с актуальным entries id, поэтому удаление активной
// карточки не оставляет потребителей с несуществующим упражнением.
export function useWorkoutFocus(entries, { preferIncomplete = false } = {}) {
  const [request, setRequest] = useState({ id: null, revision: 0 })
  const activeExerciseId = pickActiveExerciseId(entries, request.id, { preferIncomplete })
  const activateExercise = useCallback((exerciseId) => {
    const id = exerciseId ?? null
    setRequest((prev) => (
      prev.id === id ? prev : { id, revision: prev.revision + 1 }
    ))
  }, [])

  // Только ЯВНАЯ смена пользователем/добавлением карточки. Начальная загрузка
  // revision=0 и не прыгает; общий reveal-контракт учитывает reduced-motion.
  const revealKey = request.revision > 0 && activeExerciseId
    ? `${request.revision}:${activeExerciseId}`
    : null
  const activeCardRef = useRevealFocus(revealKey)

  return { activeExerciseId, activeCardRef, activateExercise }
}
