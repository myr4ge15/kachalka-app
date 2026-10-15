import { useEffect, useRef, useState } from 'react'

// Кнопка «наверх» для длинных экранов (v6.7.1 — профиль участника; с v8.8.0 общая,
// плюс «Обратная связь»). Скроллится не экран, а общий .content (App.jsx), поэтому
// контейнер ищем от своего узла. Появляется, когда прокрутили дальше `threshold`.
export default function ScrollTopButton({ threshold = 500 }) {
  const ref = useRef(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    const sc = ref.current?.parentElement?.closest('.content')
    if (!sc) return undefined
    const onScroll = () => setShow(sc.scrollTop > threshold)
    onScroll()
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [threshold])
  const toTop = () => {
    const sc = ref.current?.parentElement?.closest('.content')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    sc?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }
  return (
    <span ref={ref} className="scroll-top-anchor">
      {show && (
        <button type="button" className="scroll-top" onClick={toTop} aria-label="Наверх" title="Наверх">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5" /><path d="M6 11l6-6 6 6" />
          </svg>
        </button>
      )}
    </span>
  )
}
