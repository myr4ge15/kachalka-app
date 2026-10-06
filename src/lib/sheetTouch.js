// Жест внутри открытого листа (v6.15.1): прокручивать можно только то, что в листе
// реально прокручивается. На iPhone жест по листу, которому некуда ехать (короткий
// «Что нового»), уходил странице — пружинила вся оболочка с верхним меню (видео
// 06.10). Правило: ищем от пальца вверх ближайший блок с настоящей вертикальной
// прокруткой; нет такого или он уперся в край по ходу жеста — жест гасим.
//
// box — { scrollTop, scrollHeight, clientHeight } | null; dy — сдвиг пальца по Y
// с прошлого события (> 0 — тянут вниз, то есть листают к началу).
export function shouldBlockSheetTouch(box, dy) {
  if (!dy) return false
  if (!box) return true
  if (dy > 0) return box.scrollTop <= 0
  return box.scrollTop + box.clientHeight >= box.scrollHeight - 1
}

// Ближайший предок (от target до stop, не включая stop) с настоящей вертикальной
// прокруткой: overflow-y auto/scroll и содержимое выше бокса. getStyle — для тестов.
export function scrollableAncestor(target, stop, getStyle = (el) => getComputedStyle(el)) {
  for (let el = target; el && el !== stop && el.nodeType === 1; el = el.parentElement) {
    const oy = getStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el
  }
  return null
}
