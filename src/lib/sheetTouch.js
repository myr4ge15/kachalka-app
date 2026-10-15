// Жест внутри открытого листа (v6.15.1): прокручивать можно только то, что в листе
// реально прокручивается. На iPhone жест по листу, которому некуда ехать (короткий
// «Что нового»), уходил странице — пружинила вся оболочка с верхним меню (видео
// 06.10). Правило: ищем от пальца вверх ближайший блок с настоящей
// прокруткой по оси жеста; нет такого или он уперся в край — жест гасим.
//
// Исключение (v7.1.10) — списки с атрибутом data-sheet-bounce (пикеры): у края их
// жест НЕ гасим, iPhone сам пружинит список, как в обычных приложениях. Раньше
// тянуть список вверх у начала было «как об стену», а короткий список (фильтр
// «бицепс») не двигался вовсе. Утечки на страницу нет: у списка
// overscroll-behavior: contain, а он сам прокручивается всегда (CSS добавляет ему
// 2 px сверх высоты) — значит, жест у края достается ему, а не оболочке.
//
// box — { scrollTop, scrollHeight, clientHeight, dataset? } | null; dy — сдвиг пальца
// по Y с прошлого события (> 0 — тянут вниз, то есть листают к началу).
export function shouldBlockSheetTouch(box, dy, axis = 'y') {
  if (!dy) return false
  if (!box) return true
  if (axis === 'y' && box.dataset?.sheetBounce !== undefined) return false
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

// Свайп вниз закрывает нижний лист (v8.8.1, лист таймера отдыха): ось и порог.
// Жест «вниз» — только если вертикаль заметно преобладает и палец идет вниз;
// закрываем, если протянули на четверть высоты листа или бросили быстро.
export function swipeDownAxis(dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return null
  return dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 ? 'down' : 'other'
}

export function swipeDownCommits(dy, velocity, height) {
  if (dy <= 0) return false
  return dy > height / 4 || (velocity > 0.5 && dy > 40)
}
