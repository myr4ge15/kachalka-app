import { useCallback, useEffect, useRef } from 'react'
import { keyboardLift } from '../lib/keyboardLift.js'

// Поле над экранной клавиатурой (19.10.2026, fb_9e892d66: тап по 💬 ставил курсор в поле
// комментария, а клавиатура его закрывала). Вешается на onFocus поля: пока клавиатура
// выезжает (visualViewport resize, ~1 с), поднимаем ближайший скроллер так, чтобы блок
// boxRef (поле + кнопка) был над ней. Без visualViewport (десктоп) — ничего не делает.
// Сверху не уводим под липкую шапку (.topbar).
export function useKeyboardLift(boxRef) {
  const stop = useRef(null)
  useEffect(() => () => stop.current?.(), [])

  return useCallback(() => {
    const vv = window.visualViewport
    if (!vv) return
    stop.current?.()
    let timer = 0
    const lift = () => {
      const box = boxRef.current
      const scroller = box?.closest('.content') ?? document.scrollingElement
      if (!box || !scroller) return
      const topInset = Math.max(0, (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) - vv.offsetTop)
      const d = keyboardLift(box.getBoundingClientRect(), vv, { topInset })
      if (d) scroller.scrollBy({ top: d })
    }
    const settle = () => { clearTimeout(timer); timer = setTimeout(lift, 120) }
    vv.addEventListener('resize', settle)
    const done = setTimeout(() => stop.current?.(), 1200)
    settle()
    stop.current = () => {
      clearTimeout(timer); clearTimeout(done)
      vv.removeEventListener('resize', settle)
      stop.current = null
    }
  }, [boxRef])
}
