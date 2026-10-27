import { useCallback, useEffect, useRef } from 'react'
import { keyboardAlign, keyboardLift, keyboardOpen, sheetKeyboardInsets } from '../lib/keyboardLift.js'

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
    if (sheet) { stop.current = holdSheetAboveKeyboard(sheet, boxRef.current, vv); return }
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

// Поле в листе во весь экран над клавиатурой (переписано начисто 20.10.2026, fb_244e1492).
// Видео с iPhone (iOS 26) показало, что прежние варианты воевали с самой iOS: на тап по полю внизу она
// прокручивает страницу (vv.offsetTop > 0), а мы двигали лист или его отступы на это же смещение —
// содержимое уезжало вниз под клавиатуру или сверху оставалась пустота.
// Теперь две простые вещи, без замеров положения листа:
//  1. прокрутку страницы, которую сделала iOS, сразу отменяем (window.scrollTo(0, 0)) — лист
//     прибит к верху экрана, шапка на месте;
//  2. низ листа поднимаем отступом на высоту клавиатуры: --kb = innerHeight − vv.height.
// Лист и подложка — во весь экран (в iOS 26 строка «^ v ✓» над клавиатурой прозрачная).
// Замеры на бете (vv 383/0, sy 0, kb 410 на iPhone, iOS 26) подтвердили: прокрутки iOS здесь нет.
// Список при первой подгонке — к концу и дальше у конца, если там был: свежие комментарии над полем. Возвращает stop().
// Меньше этой доли экрана над клавиатурой не бывает (и в горизонтали ~0,38) — это кадр анимации iOS.
const MIN_VISIBLE = 0.3

export function holdSheetAboveKeyboard(sheet, box, vv) {
  const overlay = sheet.parentElement
  const scroll = sheet.querySelector('.sheet-scroll')
  let first = true
  const reset = () => {
    sheet.classList.remove('kb-fit')
    sheet.style.removeProperty('--kb')
    sheet.style.removeProperty('--kb-top')
    first = true
  }
  const unpan = () => {
    if (window.scrollY || window.pageYOffset) window.scrollTo(0, 0)
    if (document.scrollingElement?.scrollTop) document.scrollingElement.scrollTop = 0
    // iOS докручивает к полю и сами .sheet/.overlay (overflow:hidden этому не мешает).
    if (sheet.scrollTop) sheet.scrollTop = 0
    if (overlay?.scrollTop) overlay.scrollTop = 0
  }
  const apply = () => {
    if (!keyboardOpen(vv, window.innerHeight)) { reset(); return }
    // Пока клавиатура выезжает после свайпа-ответа, iOS на кадр отдает нереальное vv.height (155 из 793,
    // fb_f4aa0954): подъем на 638 бросал поле под шапку. Такие замеры пропускаем, ждем следующий resize.
    if (vv.height < window.innerHeight * MIN_VISIBLE) return
    // Прокрутку страницы (scrollY) отменяем — ее сдвиг не учитываем. Сдвиг видимой полосы без прокрутки
    // страницы (iOS 27, fb_d3f74593) не отменить — его учитываем сверху и снизу.
    const pageScrolled = (window.scrollY || window.pageYOffset || document.scrollingElement?.scrollTop || 0) > 0
    unpan()
    // Список был у конца — держим у конца и после подъема (клавиатура выезжает несколькими resize,
    // каждый ужимает список; иначе последний комментарий уходил под строку «Ответ», fb_82ee17ce).
    const atEnd = !scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 24
    // Сдвиг iOS, который не отменился (iOS 27, fb_d3f74593), — учитываем: шапка листа ниже на него, низ — по
    // нижнему краю видимой полосы, а не innerHeight − height (иначе над клавиатурой пустая полоса).
    const { top, bottom: kb } = sheetKeyboardInsets({ height: vv.height, offsetTop: pageScrolled ? 0 : vv.offsetTop }, window.innerHeight)
    sheet.style.setProperty('--kb', kb + 'px')
    sheet.style.setProperty('--kb-top', top + 'px')
    sheet.classList.add('kb-fit')
    if ((first || atEnd) && scroll) scroll.scrollTop = scroll.scrollHeight
    first = false
  }
  let left = 0
  const onFocusOut = () => { clearTimeout(left); left = setTimeout(() => { if (!box.contains(document.activeElement)) stop() }, 400) }
  const stop = () => {
    clearTimeout(left)
    vv.removeEventListener('resize', apply)
    vv.removeEventListener('scroll', apply)
    window.removeEventListener('scroll', apply)
    box.removeEventListener('focusout', onFocusOut)
    reset()
  }
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  window.addEventListener('scroll', apply)
  box.addEventListener('focusout', onFocusOut)
  apply()
  return stop
}
