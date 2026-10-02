// ============================================================================
// Переходы между экранами и свайп назад от края (v6.8.1) — чистая логика.
//
// Вкладки таббара и «Профиль» — верхний уровень: между ними экран мягко
// проявляется (fade). Вложенные экраны (уведомления, профиль друга, админка,
// «Что нового»…) въезжают справа. При возврате раскрывается сохраненный родитель
// без анимации входа: во время свайпа он уже виден под текущим экраном.
// ============================================================================

// Вложенные роуты App.jsx — у каждого есть «Назад». Новый вложенный экран — сюда же.
export const NESTED_ROUTES = new Set([
  'notif', 'member', 'freshness', 'achievements', 'admin', 'myex', 'whatsnew', 'appearance',
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

// ----------------------------- Свайп от края -------------------------------

export const EDGE_PX = 24         // жест начинается только у самого левого края
const SLOP_PX = 8                 // до этого смещения направление еще не решено

// Направление жеста по смещению от точки старта: null — рано судить; 'x' —
// горизонтальный вправо (наш жест); 'y' — прокрутка или жест влево (не трогаем).
export function swipeAxis(dx, dy) {
  if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return null
  return dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
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
