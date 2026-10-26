// Надежная установка прокрутки .content при смене экрана (v6.15.0).
//
// На iPhone `scrollTo` скроллера, который еще едет по инерции после свайпа, WebKit
// игнорирует: новый экран вставал на старой позиции — внизу, а если он короче
// прежнего, на месте контента была пустота, пока тап не останавливал инерцию
// («Настройки открываются пустыми или в самом низу»). Пока прокрутка выключена
// (overflow-y: hidden), инерции нет — позиция ставится наверняка; в следующем
// кадре прокрутку возвращаем (инлайн-стиль снимаем — снова работает CSS, в т.ч.
// html[data-sheet-open]) и ставим позицию еще раз: разметка к этому моменту
// устоялась. Возвращает отмену отложенного шага.
export function settleScroll(box, top = 0, raf = defaultRaf) {
  if (!box) return () => {}
  const y = Math.max(0, Number(top) || 0)
  box.style.overflowY = 'hidden'
  box.scrollTop = y
  let done = false
  const finish = () => {
    if (done) return
    done = true
    box.style.overflowY = ''
    box.scrollTop = y
  }
  const id = raf.request(finish)
  return () => { raf.cancel(id); finish() }
}

// Позиция скроллера, при которой el стоит по центру видимой части (выше видимой — по верху).
// Для settleScroll: мгновенно и наверняка, в отличие от scrollIntoView на iPhone.
export function centerTop(box, el) {
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect()
  const top = r.top - b.top + box.scrollTop
  return Math.max(0, r.height >= b.height ? top : top - (b.height - r.height) / 2)
}

const defaultRaf = {
  request: (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16)),
  cancel: (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)),
}

// Плавно наверх с подстраховкой (v8.7.0) — повторный тап по открытой вкладке.
// Голый smooth `scrollTo` на iPhone иногда пропускается (тот же WebKit, что выше):
// после возврата из профиля друга тап по «Ленте» мигал, а Лента стояла на месте.
// Поэтому: через checkMs позиция не сдвинулась — ставим 0 через settleScroll; через
// doneMs еще не наверху — тоже. Палец/колесо пользователя подстраховку отменяют.
// Возвращает отмену (таймеры и слушатели).
export function scrollToTop(box, { smooth = true, checkMs = 150, doneMs = 900, timers = defaultTimers, raf = defaultRaf } = {}) {
  if (!box) return () => {}
  if (!smooth) return settleScroll(box, 0, raf)
  const start = box.scrollTop
  if (!(start > 0)) return () => {}
  let touched = false
  let settled = null
  const ids = []
  const onUser = () => { touched = true }
  const off = () => {
    ids.forEach((id) => timers.clear(id))
    box.removeEventListener?.('touchstart', onUser)
    box.removeEventListener?.('wheel', onUser)
  }
  const force = () => { if (!touched && box.scrollTop > 0) settled = settleScroll(box, 0, raf) }
  box.addEventListener?.('touchstart', onUser, { passive: true })
  box.addEventListener?.('wheel', onUser, { passive: true })
  box.scrollTo({ top: 0, behavior: 'smooth' })
  ids.push(timers.set(() => { if (box.scrollTop >= start) force() }, checkMs))
  ids.push(timers.set(() => { force(); off() }, doneMs))
  return () => { off(); settled?.() }
}

const defaultTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) }
