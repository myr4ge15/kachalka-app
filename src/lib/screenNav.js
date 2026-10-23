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
  'notif', 'member', 'freshness', 'achievements', 'admin', 'myex', 'whatsnew', 'appearance', 'feedback', 'circle', 'pushset', 'friends',
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
// «назад» в iOS 26 и многих приложениях: тянуться к краю одной рукой неудобно.
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

// Идет выделение текста (v7.5.5): долгое нажатие выделило слово, и палец тянет
// ручки выделения. Это тот же touchmove вбок — без проверки свайп «назад» уводил
// экран из-под выделения. sel — window.getSelection() (или подмена в тестах).
export function textSelectionActive(sel) {
  return Boolean(sel && !sel.isCollapsed && String(sel).trim())
}

// Довели ли жест до «Назад»: треть ширины или быстрый бросок (px/мс).
export function swipeCommits(dx, velocity, width) {
  if (dx <= 0) return false
  return dx > width / 3 || (velocity > 0.45 && dx > 40)
}

// ---------------------- Доезд после отпускания (fb_37f0c1a8) ----------------------
// Раньше экран доезжал всегда за 180 мс по одной кривой: отпустил на трети ширины —
// оставшиеся ~260 px пролетали рывком, намного быстрее пальца. Теперь время и кривая
// считаются из остатка пути и скорости пальца, как в iOS: кривая стартует со
// скоростью пальца и мягко тормозит.

const VELOCITY_WINDOW_MS = 80     // скорость — по последним ~80 мс, а не по одному кадру
const VELOCITY_STALE_MS = 60      // палец постоял перед отпусканием — броска нет
const SETTLE_MIN_MS = 140
const SETTLE_MAX_MS = 320
const SETTLE_PACE = 2.8           // быстрый бросок: доезд стартует примерно со скоростью пальца
const MAX_START_SLOPE = 4         // потолок начального наклона кривой (y1 ≤ 1)

// Копит точки касания { x, t } для сглаженной скорости. Мутирует samples.
export function pushSample(samples, x, t) {
  samples.push({ x, t })
  while (samples.length > 2 && t - samples[1].t >= VELOCITY_WINDOW_MS) samples.shift()
  return samples
}

// Скорость в момент отпускания, px/мс (> 0 — вправо). endT — время touchend.
export function releaseVelocity(samples, endT) {
  if (samples.length < 2) return 0
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (Number.isFinite(endT) && endT - last.t > VELOCITY_STALE_MS) return 0
  const dt = last.t - first.t
  return dt > 0 ? (last.x - first.x) / dt : 0
}

// Был ли бросок (для «довел ли до Назад»): самая быстрая пара соседних точек в окне. Средняя скорость
// занижала короткий бросок, в конце которого палец чуть притормозил, — экран возвращался на место
// (видео владельца 23.10, справочник в Админке). Палец стоял дольше FLICK_STALE_MS — броска нет.
const FLICK_STALE_MS = 120
export function flickVelocity(samples, endT) {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  if (Number.isFinite(endT) && endT - last.t > FLICK_STALE_MS) return 0
  let best = 0
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t
    if (dt > 0) best = Math.max(best, (samples[i].x - samples[i - 1].x) / dt)
  }
  return best
}

// Время и кривая доезда: distance — сколько осталось проехать (px), velocity — скорость
// пальца В СТОРОНУ цели (px/мс; от цели или стоит — 0). Кривая — cubic-bezier, у которой
// начальный наклон совпадает со скоростью пальца: медленно отпустил — плавно разгоняется,
// бросил — продолжает с той же скоростью; конец у всех мягкий.
export function settleMotion(distance, velocity) {
  const d = Math.abs(distance)
  const v = Math.max(0, velocity || 0)
  const byDistance = 120 + d * 0.5
  const byVelocity = v > 0 ? (SETTLE_PACE * d) / v : Infinity
  const ms = Math.round(Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, Math.min(byDistance, byVelocity))))
  const slope = d >= 1 ? Math.min(MAX_START_SLOPE, (v * ms) / d) : 0
  const y1 = Math.round(slope * 0.25 * 1000) / 1000
  return { ms, easing: `cubic-bezier(0.25, ${y1}, 0.35, 1)` }
}

// Подложка (предыдущий экран) во время свайпа: стоит левее на треть своей ширины и
// притемнена, а по мере ухода текущего экрана подъезжает на место и светлеет — как в iOS.
const UNDERLAY_PARALLAX = 0.3
const UNDERLAY_DIM = 0.3

export function underlayShift(dx, width) {
  if (!(width > 0)) return 0
  const p = Math.min(1, Math.max(0, dx / width))
  return -Math.round(UNDERLAY_PARALLAX * width * (1 - p))
}

export function underlayDim(dx, width) {
  if (!(width > 0)) return 0
  const p = Math.min(1, Math.max(0, dx / width))
  return Math.round(UNDERLAY_DIM * (1 - p) * 1000) / 1000
}

// Свайп включаем только там, где у системы своего жеста нет: iOS «на экране
// Домой». В Safari-вкладке край забирает браузер (уводит со страницы), на Android
// край — системная «Назад»; наш жест там спорил бы с ними.
export function edgeSwipeSupported({ isIOS, standalone }) {
  return Boolean(isIOS && standalone)
}
