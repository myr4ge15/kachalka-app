import { useLayoutEffect } from 'react'
import { dotX } from '../lib/tabDot.js'

// Держит переезжающую точку активной вкладки (.tab-dot внутри .tabbar) под нужной
// вкладкой: пишет смещение в CSS-переменную --dot-x на меню, а видимость — в
// data-dot. Пересчет — при смене вкладки, изменении размеров меню и после загрузки
// шрифтов (подписи меняют ширину). На вложенных роутах активной вкладки нет —
// точка гаснет. На десктопе меню — колонка, там точка не нужна (скрыта в CSS).
// Первая расстановка без анимации: data-dot-ready ставится после нее, и только с
// ним CSS включает transition — иначе точка «выезжала» бы из левого угла.
export function useTabDot(navRef, activeKey) {
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return undefined
    let alive = true
    const place = () => {
      if (!alive) return
      const tab = nav.querySelector('.tab.active')
      if (!tab) { nav.dataset.dot = 'off'; return }
      nav.style.setProperty('--dot-x', `${dotX(nav.getBoundingClientRect(), tab.getBoundingClientRect())}px`)
      nav.dataset.dot = 'on'
    }
    place()
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => { if (alive) nav.dataset.dotReady = '1' })
      : null
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
    ro?.observe(nav)
    document.fonts?.ready?.then(place).catch(() => {})
    return () => {
      alive = false
      ro?.disconnect()
      if (raf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    }
  }, [navRef, activeKey])
}
