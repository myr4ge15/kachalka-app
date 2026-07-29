import { useCallback, useEffect, useRef, useState } from 'react'
import { pickActiveExerciseId } from '../lib/workoutFocus.js'

// Транзиентное UI-состояние композера: в документ тренировки и Dexie не попадает.
// Возвращаем уже согласованный с актуальным entries id, поэтому удаление активной
// карточки не оставляет потребителей с несуществующим упражнением.
export function useWorkoutFocus(entries, { preferIncomplete = false } = {}) {
  const [request, setRequest] = useState({ id: null, revision: 0 })
  const activeExerciseId = pickActiveExerciseId(entries, request.id, { preferIncomplete })
  const activeCardRef = useRef(null)
  const activateExercise = useCallback((exerciseId) => {
    const id = exerciseId ?? null
    setRequest((prev) => (
      prev.id === id ? prev : { id, revision: prev.revision + 1 }
    ))
  }, [])

  // Только ЯВНАЯ смена пользователем/добавлением карточки. Начальная загрузка
  // revision=0 и не прыгает. scrollIntoView целится в ближайший скроллер
  // (.content), а reduced-motion отключает плавную прокрутку.
  useEffect(() => {
    if (request.revision === 0 || !activeExerciseId) return
    activeCardRef.current?.scrollIntoView?.({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
      inline: 'nearest',
    })
  }, [activeExerciseId, request.revision])

  return { activeExerciseId, activeCardRef, activateExercise }
}
