import { useCallback, useEffect, useRef, useState } from 'react'
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
  // Ключи, которые экран уже видел. Нужны ТОЛЬКО режиму правки (см. markNewSetsDone):
  // отличают «подход появился только что» от «пользователь снял с него отметку» —
  // в обоих случаях ключа нет в doneKeys, а смысл противоположный.
  const seenRef = useRef(new Set(doneKeys))

  // Set в кэш кладём массивом — кэш переживает размонтирование, но не сериализуется.
  useEffect(() => {
    if (cacheKey) setCache(cacheKey, [...doneKeys])
  }, [cacheKey, doneKeys])

  // Отмена — тем же тапом и БЕЗ удаления значений подхода.
  const toggleSetDone = useCallback((exerciseId, set, si) => {
    const key = setDoneKey(exerciseId, set, si)
    seenRef.current.add(key)
    setDoneKeys((prev) => toggleDoneKey(prev, key))
    vibrate(HAPTIC.tap)
  }, [])

  // «Заменить» оставляет введённые подходы — отметки переезжают на новый id вместе
  // с ними, иначе значения сохраняются, а галочки пропадают (см. setCompletion.js).
  // Вместе с отметками переезжает и «виденность», иначе в правке снятая галочка
  // воскресла бы на новом id как «свежий подход».
  const remapExercise = useCallback((fromId, toId) => {
    seenRef.current = remapExerciseKeys(seenRef.current, fromId, toId)
    setDoneKeys((prev) => remapExerciseKeys(prev, fromId, toId))
  }, [])

  // Засев по составу: правка уже сохранённой тренировки открывается «всё выполнено»
  // (записанная тренировка по определению выполнена), пустой состав — сброс отметок.
  const markEntriesDone = useCallback((entries) => {
    const keys = allSetKeys(entries)
    seenRef.current = new Set(keys)
    setDoneKeys(new Set(keys))
  }, [])

  // Правка: подход, ПОЯВИВШИЙСЯ в составе, выполнен по умолчанию — как и всё
  // остальное в уже записанной тренировке. Без этого «+ подход», добавленное
  // упражнение и «Применить рекомендацию» (свежие `_k`) рождались бы без отметки
  // и молча выпадали из записи при сохранении (keepDoneSets). Ранее снятые
  // отметки не воскресают: их ключи уже «виденные».
  const markNewSetsDone = useCallback((entries) => {
    const fresh = allSetKeys(entries).filter((key) => !seenRef.current.has(key))
    if (fresh.length === 0) return
    fresh.forEach((key) => seenRef.current.add(key))
    setDoneKeys((prev) => new Set([...prev, ...fresh]))
  }, [])

  return { doneKeys, toggleSetDone, remapExercise, markEntriesDone, markNewSetsDone }
}
