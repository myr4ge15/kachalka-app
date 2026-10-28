import { useEffect, useRef, useState } from 'react'
import { vibrate, HAPTIC } from '../lib/haptics.js'
import { pullDistance, shouldTriggerRefresh, PULL_HOLD, PULL_THRESHOLD } from '../lib/pullRefresh.js'

// Жест «потянуть вниз для обновления» у самого верха экрана (вынесено из Ленты 28.10.2026, fb_fd2caf4e:
// тот же жест в «Уведомлениях»). Скроллится не сам экран, а родительский .content (см. App.jsx/index.css),
// поэтому touch-слушатели вешаем на него. Математика жеста (резина/порог) — lib/pullRefresh.js.
// rootRef — корень экрана, refresh — обновление (на пороге), refreshing — идет ли оно сейчас.
//
// Экран уезжает вниз за пальцем, колесико (components/ui/PullIndicator.jsx, ref — indicatorRef) стоит по
// центру открывшегося зазора; пока идет обновление, экран держится на PULL_HOLD.
// Плавность (fb_f8a87f1a): во время жеста React НЕ перерисовывается — каждое движение пальца пишет стили
// прямо в DOM (на Ленте setState на каждый touchmove пересобирал весь экран, а сдвиг `top` заново
// раскладывал страницу — экран ехал рывками). Сдвиг — translate3d, только пока жест или обновление (листы
// рендерятся порталом, их fixed это не задевает); в покое transform снят. Отпустил — экран доезжает
// переходом. Состояние React — только busy (иконка колесика: стрелка ↔ крутится).
const SIZE = 32 // px, как .ptr в index.css
const SETTLE = 'transform var(--dur-slow) cubic-bezier(.2, .8, .2, 1), opacity var(--dur-slow) ease-out'

export function usePullToRefresh(rootRef, refresh, refreshing) {
  const [busy, setBusy] = useState(false)
  const indicatorRef = useRef(null)
  const busyRef = useRef(false)
  const refreshingRef = useRef(refreshing)
  refreshingRef.current = refreshing

  // Сдвиг экрана и колесика. progress 0..1 — прозрачность и поворот стрелки; animate — доехать переходом.
  const place = (offset, { progress = offset > 0 ? 1 : 0, animate = false } = {}) => {
    const root = rootRef.current
    const ind = indicatorRef.current
    const transition = animate ? SETTLE : 'none'
    if (root) {
      root.style.transition = transition
      root.style.transform = offset > 0 ? `translate3d(0, ${offset}px, 0)` : ''
    }
    if (ind) {
      ind.style.transition = transition
      ind.style.transform = `translate(-50%, ${-(offset + SIZE) / 2}px)`
      ind.style.opacity = String(progress)
      ind.classList.toggle('ready', busyRef.current || offset >= PULL_THRESHOLD)
      const ico = ind.firstElementChild
      if (ico) ico.style.transform = busyRef.current ? '' : `rotate(${progress * 180}deg)`
    }
  }
  const placeRef = useRef(place)
  placeRef.current = place

  // Обновление завершилось — экран плавно возвращается, колесико гаснет. Зовется и по флагу refreshing,
  // и по концу самого refresh(): офлайн refresh выходит сразу, флаг не меняется — экран не должен зависнуть.
  const release = () => {
    if (!busyRef.current || refreshingRef.current) return
    busyRef.current = false
    setBusy(false)
    placeRef.current(0, { animate: true })
  }
  const releaseRef = useRef(release)
  releaseRef.current = release
  useEffect(() => { if (!refreshing) releaseRef.current() }, [refreshing])

  useEffect(() => {
    const root = rootRef.current
    const sc = root?.closest('.content')
    if (!sc) return
    let startY = null
    let startX = null
    let active = false
    let dist = 0

    const onStart = (e) => {
      // .content общий: под вложенным экраном слой жив, но inert — жест там не наш (UI-ревью 23.10).
      if (root.closest('[inert]')) { startY = null; return }
      // Начинаем следить за жестом только у самого верха и не во время обновления.
      startY = (!refreshingRef.current && !busyRef.current && sc.scrollTop <= 0) ? e.touches[0].clientY : null
      startX = e.touches[0].clientX ?? 0
      active = false
      dist = 0
    }
    const onMove = (e) => {
      if (startY == null) return
      if (sc.scrollTop > 0) { startY = null; if (active) { active = false; placeRef.current(0, { animate: true }) } return }
      const raw = e.touches[0].clientY - startY
      if (!active) {
        const dx = (e.touches[0].clientX ?? 0) - startX
        if (Math.max(Math.abs(dx), Math.abs(raw)) < 4) return
        // Горизонталь — прокрутка ряда или свайп «назад», не обновление.
        if (Math.abs(dx) > Math.abs(raw)) { startY = null; return }
      }
      if (raw <= 0) { if (active) { active = false; dist = 0; placeRef.current(0, { animate: true }) } return }
      active = true
      // Забираем жест у нативного оверскролла, чтобы тянулся наш экран.
      e.preventDefault()
      dist = pullDistance(raw)
      placeRef.current(dist, { progress: Math.min(dist / PULL_THRESHOLD, 1) })
    }
    const onEnd = () => {
      if (startY == null) return
      startY = null
      const triggered = active && shouldTriggerRefresh(dist) && !refreshingRef.current
      active = false
      dist = 0
      if (triggered) {
        vibrate(HAPTIC.tap)
        busyRef.current = true
        setBusy(true)
        placeRef.current(PULL_HOLD, { animate: true })
        Promise.resolve().then(refresh).catch(() => {}).finally(() => releaseRef.current())
      } else {
        placeRef.current(0, { animate: true })
      }
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

  return { indicatorRef, busy }
}
