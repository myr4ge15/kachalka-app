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

const defaultRaf = {
  request: (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16)),
  cancel: (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)),
}
