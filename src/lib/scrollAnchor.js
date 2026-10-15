// ============================================================================
// Якорь прокрутки (v6.7.1): вернуться ровно туда, откуда ушли на вложенный экран.
// Чистая математика без DOM-доступа — DOM-обвязка в hooks/useScrollAnchor.js.
//
// Запоминаем не голый scrollTop, а ЭЛЕМЕНТ, по которому тапнули (data-anchor), и
// его отступ от верха скроллера. Лента при возврате монтируется заново и грузит
// кэш асинхронно, а рейтинг над постами на мобиле может появиться позже и сдвинуть
// всё вниз — голый scrollTop промахнулся бы мимо карточки.
// ============================================================================

// Снимок: anchor — ключ data-anchor, offset — где был элемент относительно верха
// скроллера (px), scrollTop — запасной вариант, если элемента больше нет.
export function makeAnchor(anchor, elTop, containerTop, scrollTop) {
  return {
    anchor: anchor ?? null,
    offset: Number.isFinite(elTop - containerTop) ? elTop - containerTop : 0,
    scrollTop: Math.max(0, Number(scrollTop) || 0),
  }
}

// Куда прокрутить сейчас. Элемент найден → сдвиг так, чтобы он встал на прежний
// отступ; не найден → прежний scrollTop. Результат ограничен [0, maxScroll].
// snap.center (v8.9.8, пуш о реакции): элемент серединой в середину скроллера; выше
// скроллера — как обычно, верхом на snap.offset (иначе обрезалось бы начало карточки).
export function anchorTarget(snap, { scrollTop, elTop = null, containerTop = 0, maxScroll = Infinity, elHeight = 0, viewHeight = 0 }) {
  const centered = snap.center && elHeight > 0 && viewHeight > 0 && elHeight <= viewHeight
  const want = centered ? (viewHeight - elHeight) / 2 : snap.offset
  const raw = elTop == null
    ? snap.scrollTop
    : scrollTop + (elTop - containerTop - want)
  return Math.round(Math.min(Math.max(0, raw), Math.max(0, maxScroll)))
}
