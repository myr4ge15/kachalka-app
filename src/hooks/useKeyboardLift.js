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
    // Поле внутри листа во весь экран (ветка комментариев, 20.10.2026, fb_904e3fb8): прокручивать
    // нечего — iOS уводил весь экран вверх, а клавиатура закрывала поле. Лист ужимаем до видимой
    // части над клавиатурой, как в мессенджерах: шапка сверху, поле над клавиатурой, список между.
    const sheet = boxRef.current?.closest('.sheet')
    if (sheet) { stop.current = fitSheetToKeyboard(sheet, boxRef.current, vv); return }
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

// Пока клавиатура открыта — содержимое листа ровно в видимой полосе над ней: верхний отступ листа
// растет на часть, уехавшую вверх (iOS сдвигает видимую область — vv.offsetTop), нижний — на часть,
// закрытую клавиатурой. Сам лист и подложка остаются во весь экран: в iOS 26 строка «^ v ✓» над
// клавиатурой прозрачная, и лист, обрезанный по видимой области, показывал сквозь нее карточку под
// ним (fb_83895083). Закрылась клавиатура — прежние отступы. Слушаем, пока фокус внутри блока поля.
// Список ветки при первой подгонке прокручиваем к концу: свежие комментарии — над полем.
// Возвращает функцию остановки (сбрасывает стили).
export function fitSheetToKeyboard(sheet, box, vv) {
  const overlay = sheet.parentElement
  const scroll = sheet.querySelector('.sheet-scroll')
  let fitted = false
  const reset = () => {
    sheet.style.paddingTop = sheet.style.paddingBottom = ''
    sheet.classList.remove('kb-fit')
    fitted = false
  }
  const apply = () => {
    if (!keyboardOpen(vv, window.innerHeight)) { reset(); return }
    // fb_837481a4: пока выезжает клавиатура, iOS докручивает к полю и сами .sheet/.overlay (overflow:hidden
    // прокрутке не мешает) — шапка уезжала вверх. Сдвиг сбрасываем до замера: прокручивается только список.
    sheet.scrollTop = 0
    if (overlay) overlay.scrollTop = 0
    const rect = sheet.getBoundingClientRect()
    const above = Math.max(0, Math.round(vv.offsetTop - rect.top))
    const below = Math.max(0, Math.round(rect.bottom - (vv.offsetTop + vv.height)))
    sheet.style.paddingTop = `calc(16px + env(safe-area-inset-top) + ${above}px)`
    sheet.style.paddingBottom = `${below + 8}px`
    sheet.classList.add('kb-fit')
    if (!fitted && scroll) scroll.scrollTop = scroll.scrollHeight
    fitted = true
  }
  let left = 0
  const onFocusOut = () => { clearTimeout(left); left = setTimeout(() => { if (!box.contains(document.activeElement)) stop() }, 400) }
  const stop = () => {
    clearTimeout(left)
    vv.removeEventListener('resize', apply)
    vv.removeEventListener('scroll', apply)
    box.removeEventListener('focusout', onFocusOut)
    reset()
  }
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  box.addEventListener('focusout', onFocusOut)
  apply()
  return stop
}
