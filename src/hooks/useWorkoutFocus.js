import { useCallback, useEffect, useRef, useState } from 'react'
import { readDraft, writeDraft } from '../lib/draftStore.js'
import { centerTop, settleScroll } from '../lib/scrollBox.js'
import { nextFocusRequest, pickActiveExerciseId } from '../lib/workoutFocus.js'
import { useRevealFocus } from './useRevealFocus.js'

// Транзиентное UI-состояние композера: в документ тренировки и Dexie не попадает.
// Возвращаем уже согласованный с актуальным entries id, поэтому удаление активной
// карточки не оставляет потребителей с несуществующим упражнением.
// storeKey (fb_0f3069ec): выбранное упражнение новой тренировки живет рядом с черновиком
// (lib/draftStore) — уход на другую вкладку размонтирует композер, и без этого по
// возвращении раскрывалось первое упражнение, а не то, на котором остановились.
// Восстановленную карточку один раз ставим по центру — мгновенно, через settleScroll. Через
// два кадра: HistoryScreen при открытии сам ставит .content наверх (его эффект идет ПОСЛЕ
// нашего, а settleScroll повторяет позицию еще через кадр) — раньше он бы нас перебил.
export function useWorkoutFocus(entries, { preferIncomplete = false, startCollapsed = false, storeKey = null } = {}) {
  const [request, setRequest] = useState(() => ({ id: (storeKey && readDraft(storeKey)) || null, revision: 0 }))
  useEffect(() => {
    if (storeKey && request.id) writeDraft(storeKey, request.id)
  }, [storeKey, request.id])
  const activeExerciseId = pickActiveExerciseId(entries, request.id, { preferIncomplete, collapsed: startCollapsed })
  // Актуальный активный id нужен внутри стабильного колбэка: reveal обязан
  // отличать переход на ДРУГОЕ упражнение от тапа внутри уже открытой карточки
  // (см. nextFocusRequest — иначе экран уезжает под пальцем).
  const activeIdRef = useRef(null)
  activeIdRef.current = activeExerciseId
  const activateExercise = useCallback((exerciseId) => {
    setRequest((prev) => nextFocusRequest(prev, exerciseId, activeIdRef.current))
  }, [])

  // Только ЯВНАЯ смена пользователем/добавлением карточки. Начальная загрузка
  // revision=0 и не прыгает; общий reveal-контракт учитывает reduced-motion.
  const revealKey = request.revision > 0 && activeExerciseId
    ? `${request.revision}:${activeExerciseId}`
    : null
  const activeCardRef = useRevealFocus(revealKey)

  const [restoredId] = useState(() => (request.id && entries?.some((e) => e?.exercise?.id === request.id) ? request.id : null))
  useEffect(() => {
    if (!restoredId) return undefined
    let inner = null, undo = null
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const el = activeCardRef.current, box = el?.closest?.('.content')
        if (el && box) undo = settleScroll(box, centerTop(box, el))
      })
    })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); undo?.() }
  }, [restoredId, activeCardRef])

  return { activeExerciseId, activeCardRef, activateExercise }
}
