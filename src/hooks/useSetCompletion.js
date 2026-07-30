import { useCallback, useEffect, useState } from 'react'
import { allSetKeys, remapExerciseKeys, setDoneKey, toggleDoneKey } from '../lib/setCompletion.js'
import { getCache, setCache } from '../lib/cache.js'
import { vibrate, HAPTIC } from '../lib/haptics.js'

// Отметки «подход выполнен» (PLAN-workout-focus, Slice 2). Транзиентное UI-состояние:
// в документ тренировки и Dexie не попадает, схема и синк не меняются.
//
// `cacheKey` — опциональный ключ сессионного кэша (lib/cache.js, память): черновик
// новой тренировки уже переживает уход с экрана, и отметки должны переживать вместе
// с ним, иначе взгляд в Ленту посреди занятия сбрасывал бы все галочки.
export function useSetCompletion({ cacheKey = null } = {}) {
  const [doneKeys, setDoneKeys] = useState(() => new Set(
    cacheKey ? getCache(cacheKey) ?? [] : []
  ))

  // Set в кэш кладём массивом — кэш переживает размонтирование, но не сериализуется.
  useEffect(() => {
    if (cacheKey) setCache(cacheKey, [...doneKeys])
  }, [cacheKey, doneKeys])

  // Отмена — тем же тапом и БЕЗ удаления значений подхода.
  const toggleSetDone = useCallback((exerciseId, set, si) => {
    setDoneKeys((prev) => toggleDoneKey(prev, setDoneKey(exerciseId, set, si)))
    vibrate(HAPTIC.tap)
  }, [])

  // «Заменить» оставляет введённые подходы — отметки переезжают на новый id вместе
  // с ними, иначе значения сохраняются, а галочки пропадают (см. setCompletion.js).
  const remapExercise = useCallback((fromId, toId) => {
    setDoneKeys((prev) => remapExerciseKeys(prev, fromId, toId))
  }, [])

  // Засев по составу: правка уже сохранённой тренировки открывается «всё выполнено»
  // (записанная тренировка по определению выполнена), пустой состав — сброс отметок.
  const markEntriesDone = useCallback((entries) => {
    setDoneKeys(new Set(allSetKeys(entries)))
  }, [])

  return { doneKeys, toggleSetDone, remapExercise, markEntriesDone }
}
