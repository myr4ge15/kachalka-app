// Жест внутри открытого листа (v6.15.1): прокручивать можно только то, что в листе
// реально прокручивается. На iPhone жест по листу, которому некуда ехать (короткий
// «Что нового»), уходил странице — пружинила вся оболочка с верхним меню (видео
// 06.10). Правило: ищем от пальца вверх ближайший блок с настоящей
// прокруткой по оси жеста; нет такого или он уперся в край — жест гасим.
//
// box — { scrollTop, scrollHeight, clientHeight } | null; dy — сдвиг пальца по Y
// с прошлого события (> 0 — тянут вниз, то есть листают к началу).
export function shouldBlockSheetTouch(box, dy, axis = 'y') {
  if (!dy) return false
  if (!box) return true
  const position = axis === 'x' ? box.scrollLeft : box.scrollTop
  const client = axis === 'x' ? box.clientWidth : box.clientHeight
  const size = axis === 'x' ? box.scrollWidth : box.scrollHeight
  if (dy > 0) return position <= 0
  return position + client >= size - 1
}

// Ближайший предок до stop с прокруткой по выбранной оси. getStyle — для тестов.
export function scrollableAncestor(target, stop, getStyle = (el) => getComputedStyle(el), axis = 'y') {
  for (let el = target; el && el !== stop && el.nodeType === 1; el = el.parentElement) {
    const style = getStyle(el)
    const overflow = axis === 'x' ? style.overflowX : style.overflowY
    const size = axis === 'x' ? el.scrollWidth : el.scrollHeight
    const client = axis === 'x' ? el.clientWidth : el.clientHeight
    if ((overflow === 'auto' || overflow === 'scroll') && size > client + 1) return el
  }
  return null
}
