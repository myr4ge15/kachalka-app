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

// Отступы листа во весь экран при открытой клавиатуре (27.10.2026, fb_d3f74593): видимая полоса — [offsetTop,
// offsetTop + height] в координатах окна. Сверху — сдвиг iOS (offsetTop: шапку листа иначе уводило за экран), снизу —
// все, что ниже видимой полосы (клавиатура). Раньше низ считали как innerHeight − height: на iOS 27 со сдвигом
// между полем и клавиатурой оставалась пустая полоса высотой ровно в этот сдвиг.
export function sheetKeyboardInsets(vv, innerHeight) {
  if (!vv || !(innerHeight > 0) || !(vv.height > 0)) return { top: 0, bottom: 0 }
  const top = Math.max(0, Math.round(vv.offsetTop || 0))
  return { top, bottom: Math.max(0, Math.round(innerHeight - top - vv.height)) }
}

// Открыта ли экранная клавиатура: на iOS она сжимает только visualViewport, окно остается прежним.
export function keyboardOpen(vv, innerHeight) {
  return Boolean(vv) && innerHeight > 0 && vv.height < innerHeight * 0.85
}
