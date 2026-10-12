// ============================================================================
// Переходы между экранами и свайп назад (v6.8.1; с любой точки — v7.1.7) — чистая логика.
//
// Вкладки таббара и «Профиль» — верхний уровень: между ними экран мягко
// проявляется (fade). Вложенные экраны (уведомления, профиль друга, админка,
// «Что нового»…) въезжают справа. При возврате раскрывается сохраненный родитель
// без анимации входа: во время свайпа он уже виден под текущим экраном.
// ============================================================================

// Вложенные роуты App.jsx — у каждого есть «Назад». Новый вложенный экран — сюда же.
export const NESTED_ROUTES = new Set([
  'notif', 'member', 'freshness', 'achievements', 'admin', 'myex', 'whatsnew', 'appearance', 'feedback', 'circle', 'pushset',
])

export function isNested(tab) {
  return NESTED_ROUTES.has(tab)
}

// Сохраняем только предков текущего экрана, а не все посещенные вкладки.
// Возврат раскрывает тот же экземпляр со своими данными и состоянием.
export function nextScreenStack(stack, next) {
  const index = stack.indexOf(next)
  if (index >= 0) return stack.slice(0, index + 1)
  return isNested(next) ? [...stack, next] : [next]
}

export function initialScreenStack(tab) {
  if (!isNested(tab)) return [tab]
  const parent = tab === 'member' ? 'feed' : ['notif', 'freshness'].includes(tab) ? 'home' : 'profile'
  return [parent, tab]
}

// 'fade' | 'push' | 'pop' — как показать смену prev → next.
export function transitionKind(prev, next) {
  if (prev === next) return 'fade'
  const a = isNested(prev)
  const b = isNested(next)
  if (b) return 'push'            // вглубь (и вбок между вложенными)
  if (a) return 'pop'             // назад на верхний уровень
  return 'fade'                   // вкладка ↔ вкладка
}

// ------------------------------ Свайп назад --------------------------------
// С v7.1.7 жест начинается с ЛЮБОЙ точки экрана, а не только у края — как
// «назад» в iOS 26, Telegram, Instagram: тянуться к краю одной рукой неудобно.
// Цена — спор с тем, что внутри экрана тоже ездит вбок, поэтому от середины
// условия строже (ось — `swipeAxis(..., false)`, препятствия — `swipeBackBlocked`).
// У самого края, как и раньше, жест наш всегда.

export const EDGE_PX = 24         // у края — прежний мягкий жест
const SLOP_PX = 8                 // до этого смещения направление еще не решено
const EDGE_RATIO = 1.2            // у края: |dx| > |dy| × 1.2
const INNER_RATIO = 1.6           // от середины: явная горизонталь, диагональ — прокрутке

// Направление жеста по смещению от точки старта: null — рано судить; 'x' —
// горизонтальный вправо (наш жест); 'y' — прокрутка или жест влево (не трогаем).
// fromEdge=false — жест начат не у края: горизонталь должна преобладать сильнее,
// иначе листание длинного экрана «по дуге» уводило бы назад.
export function swipeAxis(dx, dy, fromEdge = true) {
  if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return null
  const ratio = fromEdge ? EDGE_RATIO : INNER_RATIO
  return dx > 0 && Math.abs(dx) > Math.abs(dy) * ratio ? 'x' : 'y'
}

// Поля и ползунки ведут палец сами (курсор, выделение, «Свой цвет»); ручки
// перетаскивания — touch-action:none; [data-no-swipe-back] — явный отказ блока.
const OWN_GESTURE = 'input, textarea, select, [contenteditable="true"], [data-no-swipe-back]'

// Жест, начатый НЕ у края, принадлежит элементу под пальцем, если тот сам
// ездит вбок: поле/ползунок/ручка или блок с горизонтальной прокруткой, который
// еще есть куда листать влево (ряд чипов). Ряд у левого края вправо не листается —
// тогда жест наш, как в iOS. Идем от target вверх до stop (скроллер экрана).
// getStyle — для тестов.
export function swipeBackBlocked(target, stop, getStyle = (el) => getComputedStyle(el)) {
  for (let el = target; el && el !== stop && el.nodeType === 1; el = el.parentElement) {
    if (el.matches?.(OWN_GESTURE)) return true
    const style = getStyle(el)
    if (style.touchAction === 'none') return true
    const scrollsX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1
    if (scrollsX && el.scrollLeft > 0) return true
  }
  return false
}

// Довели ли жест до «Назад»: треть ширины или быстрый бросок (px/мс).
export function swipeCommits(dx, velocity, width) {
  if (dx <= 0) return false
  return dx > width / 3 || (velocity > 0.45 && dx > 40)
}

// Свайп включаем только там, где у системы своего жеста нет: iOS «на экране
// Домой». В Safari-вкладке край забирает браузер (уводит со страницы), на Android
// край — системная «Назад»; наш жест там спорил бы с ними.
export function edgeSwipeSupported({ isIOS, standalone }) {
  return Boolean(isIOS && standalone)
}
