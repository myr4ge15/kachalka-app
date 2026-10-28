import { useEffect, useRef, useState } from 'react'
import { vibrate, HAPTIC } from '../lib/haptics.js'
import { pullDistance, shouldTriggerRefresh, PULL_HOLD } from '../lib/pullRefresh.js'

// Жест «потянуть вниз для обновления» у самого верха экрана (вынесено из Ленты 28.10.2026, fb_fd2caf4e:
// тот же жест в «Уведомлениях»). Скроллится не сам экран, а родительский .content (см. App.jsx/index.css),
// поэтому touch-слушатели вешаем на него. Математика жеста (резина/порог) — lib/pullRefresh.js.
// rootRef — корень экрана, refresh — обновление (на пороге), refreshing — идет ли оно сейчас.
// Экран уезжает вниз за пальцем (28.10.2026, как в iOS: в «Уведомлениях» колесико по центру ложилось на
// заголовок), колесико — по центру открывшегося зазора; пока идет обновление, экран держится на PULL_HOLD.
// Сдвиг — `top` у корня (position: relative), НЕ transform: transform ломает position: fixed листов внутри.
// Возвращает { pull, dragging, busy, offset, style }: style — на корень экрана, остальное —
// components/ui/PullIndicator.jsx; busy — обновление, ЗАПУЩЕННОЕ жестом (тихий авто-refresh экран не двигает).
export function usePullToRefresh(rootRef, refresh, refreshing) {
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const pullRef = useRef(0)
  const refreshingRef = useRef(refreshing)
  refreshingRef.current = refreshing

  // Обновление завершилось — гасим спиннер жеста.
  useEffect(() => { if (!refreshing) setBusy(false) }, [refreshing])

  useEffect(() => {
    const root = rootRef.current
    const sc = root?.closest('.content')
    if (!sc) return
    let startY = null
    let startX = null
    let active = false
    const setPx = (v) => { pullRef.current = v; setPull(v) }

    const onStart = (e) => {
      // .content общий: под вложенным экраном слой жив, но inert — жест там не наш (UI-ревью 23.10).
      if (root.closest('[inert]')) { startY = null; return }
      // Начинаем следить за жестом только у самого верха и не во время обновления.
      startY = (!refreshingRef.current && sc.scrollTop <= 0) ? e.touches[0].clientY : null
      startX = e.touches[0].clientX ?? 0
      active = false
    }
    const onMove = (e) => {
      if (startY == null) return
      if (sc.scrollTop > 0) { startY = null; active = false; setDragging(false); setPx(0); return }
      const raw = e.touches[0].clientY - startY
      if (!active) {
        const dx = (e.touches[0].clientX ?? 0) - startX
        if (Math.max(Math.abs(dx), Math.abs(raw)) < 4) return
        // Горизонталь — прокрутка ряда или свайп «назад», не обновление.
        if (Math.abs(dx) > Math.abs(raw)) { startY = null; return }
      }
      if (raw <= 0) { if (active) { active = false; setDragging(false); setPx(0) } return }
      if (!active) { active = true; setDragging(true) }
      // Забираем жест у нативного оверскролла, чтобы тянулся наш индикатор.
      e.preventDefault()
      setPx(pullDistance(raw))
    }
    const onEnd = () => {
      if (startY == null) return
      startY = null
      const triggered = active && shouldTriggerRefresh(pullRef.current) && !refreshingRef.current
      active = false
      setDragging(false)
      setPx(0)
      if (triggered) { vibrate(HAPTIC.tap); setBusy(true); refresh() }
    }

    sc.addEventListener('touchstart', onStart, { passive: true })
    sc.addEventListener('touchmove', onMove, { passive: false })
    sc.addEventListener('touchend', onEnd)
    sc.addEventListener('touchcancel', onEnd)
    return () => {
      sc.removeEventListener('touchstart', onStart)
      sc.removeEventListener('touchmove', onMove)
      sc.removeEventListener('touchend', onEnd)
      sc.removeEventListener('touchcancel', onEnd)
    }
  }, [rootRef, refresh])

  const offset = busy ? PULL_HOLD : pull
  const style = { top: `${offset}px`, transition: dragging ? 'none' : 'top var(--dur-base) var(--ease-out)' }
  return { pull, dragging, busy, offset, style }
}
