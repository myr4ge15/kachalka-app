import { useState } from 'react'

// Общий режим «выбор + экспорт» для списков (История тренировок, Шаблоны).
// Раньше selectMode/picked/togglePick/pickAll/exportPicked были почти дословно
// скопированы в оба экрана (РЕВЬЮ-КОДА-2026-07-13). Здесь — единый источник.
//
// exportFn(chosen, appVersion) — конкретная выгрузка (exportWorkouts/exportTemplates).
// pickAll(items)/exportPicked(items) принимают актуальный список ЯВНО: у Истории
// «Все» берёт отфильтрованный список (shown), а выгрузка — из полного (list).
export function useExportSelection(exportFn) {
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState(() => new Set())

  const toggleSelectMode = () => {
    setSelectMode((on) => !on)
    setPicked(new Set())
  }
  const togglePick = (id) => {
    setPicked((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const pickAll = (items) => setPicked(new Set((items ?? []).map((x) => x.id)))
  const exportPicked = (items) => {
    const chosen = (items ?? []).filter((x) => picked.has(x.id))
    if (!chosen.length) return
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    exportFn(chosen, appVersion)
    setSelectMode(false)
    setPicked(new Set())
  }

  return { selectMode, picked, toggleSelectMode, togglePick, pickAll, exportPicked }
}
