import { useEffect, useLayoutEffect, useRef } from 'react'
import { useEdgeSwipeBack } from '../../hooks/useEdgeSwipeBack.js'
import { settleScroll } from '../../lib/scrollBox.js'

// Экран внутри экрана (23.10.2026: разделы Админки, упражнение в справочнике и в «Каталоге»). Тот же
// прием, что «Настройки» в Профиле: снизу — исходный экран (under) остается смонтированным со своим
// состоянием и прокруткой, сверху въезжает новый (children); «назад» — кнопкой или свайпом, под
// свайпом виден исходный. Открытие — с верха, возврат — на прежнее место списка.
// Пропсы: open, onBack(), under, children, contentRef (скроллер .content), swipe — включить свайп
// (iOS «на экране Домой» и только когда выше не открыт еще один слой).
export default function NavLayers({ open, onBack, under, children, contentRef, swipe = false }) {
  const topRef = useRef(null)
  const underRef = useRef(null)
  const underTop = useRef(0)

  // Позиция исходного экрана — пока он открыт: после открытия .content уже другой высоты.
  useEffect(() => {
    const box = contentRef?.current
    if (open || !box) return undefined
    // data-scroll-top читает свайп (useEdgeSwipeBack): подложка встает на то же место списка.
    const keep = () => {
      underTop.current = box.scrollTop
      if (underRef.current) underRef.current.dataset.scrollTop = String(box.scrollTop)
    }
    keep()
    box.addEventListener('scroll', keep, { passive: true })
    return () => box.removeEventListener('scroll', keep)
  }, [open, contentRef])

  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return undefined }
    const box = contentRef?.current
    return box ? settleScroll(box, open ? 0 : underTop.current) : undefined
  }, [open, contentRef])

  useEdgeSwipeBack(contentRef, topRef, onBack, Boolean(swipe && open))

  return (
    <div className="nav-stack">
      <div ref={underRef} className={open ? 'nav-layer nav-underlay' : 'nav-layer nav-current'} inert={open}
        aria-hidden={open ? true : undefined}>
        {under}
      </div>
      {open && <div ref={topRef} className="nav-layer nav-current screen-anim screen-anim--push">{children}</div>}
    </div>
  )
}
