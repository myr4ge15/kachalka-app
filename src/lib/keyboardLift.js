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
