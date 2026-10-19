import { useCallback, useEffect, useRef } from 'react'
import { keyboardAlign, keyboardLift, keyboardOpen } from '../lib/keyboardLift.js'

// Поле над экранной клавиатурой (19.10.2026, fb_9e892d66: тап по 💬 ставил курсор в поле
// комментария, а клавиатура его закрывала). Вешается на onFocus поля: пока клавиатура
// выезжает (visualViewport resize, ~1 с), поднимаем ближайший скроллер так, чтобы блок
// boxRef (поле + кнопка) был над ней. Без visualViewport (десктоп) — ничего не делает.
// Сверху не уводим под липкую шапку (.topbar).
// Клавиатура открыта (fb_5b764337) — низ карточки (.card вокруг поля) встает ровно над ней, в обе стороны:
// центрирование ветки поднимало поле к середине экрана, а под карточкой оставалась пустая полоса.
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
      const field = box.getBoundingClientRect()
      const card = box.closest('.card')
      const d = card && keyboardOpen(vv, window.innerHeight)
        ? keyboardAlign(card.getBoundingClientRect(), field, vv, { topInset })
        : keyboardLift(field, vv, { topInset })
      // Абсолютная позиция, а не scrollBy (fb_17aad9f1): на iPhone прокрутку .content ведет процесс интерфейса,
      // и пока выезжает клавиатура, iOS сам докручивает к полю, а страница еще видит старые координаты.
      // Относительный сдвиг ложился поверх системного — экран улетал на две карточки вниз. scrollTop и rect
      // сняты в одном замере, поэтому цель верна, а повторный расчет (resize клавиатуры) ее не удваивает.
      if (d) scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + d) })
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
