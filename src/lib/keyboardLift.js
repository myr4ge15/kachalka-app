// Насколько прокрутить экран, чтобы поле оказалось над экранной клавиатурой (19.10.2026,
// fb_9e892d66). Клавиатура iOS не сжимает layout viewport — она сжимает visualViewport,
// поэтому scrollIntoView({block:'end'}) оставлял поле под ней. Координаты — как у
// getBoundingClientRect (layout viewport): видимая полоса — [offsetTop, offsetTop + height].
//   rect — { top, bottom } поля (с кнопкой отправки), vv — { offsetTop, height },
//   margin — зазор над клавиатурой, topInset — липкая шапка сверху.
// > 0 — прокрутить вниз на столько, < 0 — вверх (поле ушло под шапку), 0 — видно.
export function keyboardLift(rect, vv, { margin = 12, topInset = 0 } = {}) {
  if (!rect || !vv || !(vv.height > 0)) return 0
  const top = vv.offsetTop + topInset
  const bottom = vv.offsetTop + vv.height - margin
  if (rect.bottom > bottom) {
    const delta = rect.bottom - bottom
    // Поле выше видимой полосы — показываем его верх, а не низ.
    return rect.top - delta < top ? Math.max(0, rect.top - top) : Math.round(delta)
  }
  if (rect.top < top) return Math.round(rect.top - top)
  return 0
}

// Выравнивание по клавиатуре (19.10.2026, fb_5b764337): при открытой клавиатуре низ карточки (block —
// { bottom } карточки тренировки) встает ровно над ней — экран не уезжает выше нужного (центрирование
// ветки поднимало поле к середине, внизу оставалась пустая полоса). Двигаем и вниз, и вверх.
// Поле (field — { top }) при этом не уходит под шапку: длинная карточка — по полю, не по низу.
// Та же система координат, что у keyboardLift. 0 — двигать не нужно.
export function keyboardAlign(block, field, vv, { margin = 12, topInset = 0 } = {}) {
  if (!block || !field || !vv || !(vv.height > 0)) return 0
  const top = vv.offsetTop + topInset
  const bottom = vv.offsetTop + vv.height - margin
  let d = block.bottom - bottom
  if (field.top - d < top) d = field.top - top
  return Math.round(d)
}

// Открыта ли экранная клавиатура: на iOS она сжимает только visualViewport, окно остается прежним.
export function keyboardOpen(vv, innerHeight) {
  return Boolean(vv) && innerHeight > 0 && vv.height < innerHeight * 0.85
}
