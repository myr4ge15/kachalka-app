// Приветствие новичка (v6.15.0): лист «Добро пожаловать» один раз после регистрации
// по приглашению (components/WelcomeSheet.jsx, показывает App через useLaunchSheets).
// Отметка — в localStorage на устройстве, где человек зарегистрировался: «pending»
// ставит регистрация, «done» — закрытие листа. Учетки, созданные до 6.15.0 или
// админом, отметки не получают — им лист не нужен.
// storage — Web Storage (по умолчанию localStorage); недоступное хранилище = «нет отметки».

export const welcomeKey = (userId) => `gym_app_welcome_${userId}`

function read(storage, key) {
  try { return storage?.getItem(key) ?? null } catch { return null }
}
function write(storage, key, value) {
  try { storage?.setItem(key, value) } catch { /* приватный режим — живем без отметки */ }
}

export function markWelcomePending(userId, storage = globalThis.localStorage) {
  if (!userId || read(storage, welcomeKey(userId)) === 'done') return
  write(storage, welcomeKey(userId), 'pending')
}

export function isWelcomePending(userId, storage = globalThis.localStorage) {
  return Boolean(userId) && read(storage, welcomeKey(userId)) === 'pending'
}

export function markWelcomeDone(userId, storage = globalThis.localStorage) {
  if (userId) write(storage, welcomeKey(userId), 'done')
}

// Карточки листа. Тексты сверены с приложением (docs/quick-start.md): «+» в меню,
// рекомендация и «Как пошло?» в композере, Прогресс/цели, Восстановление, Лента.
export const WELCOME_STEPS = [
  {
    e: '🏋️',
    title: 'Записывай прямо в зале',
    text: 'Жми «+» внизу и добавляй упражнения по ходу. Вес и повторы — кнопками ±. Начатая тренировка не потеряется, даже если закрыть приложение.',
  },
  {
    e: '🎯',
    title: 'Подскажем вес на сегодня',
    text: 'В следующий раз увидишь прошлый результат и рекомендацию. Отметь, как пошло: легко, нормально или тяжело, — подсказка это учтет.',
  },
  {
    e: '📈',
    title: 'Смотри, как растешь',
    text: 'В «Прогрессе» — график по каждому упражнению, рекорды и цели. На Главной — серия недель и какие мышцы пора нагрузить.',
  },
  {
    e: '👥',
    title: 'Тренируйся с друзьями',
    text: 'В «Ленте» — тренировки твоего круга и реакции на них. С кем ты в круге, решает админ.',
  },
]

// Следующий шаг по свайпу: dx < 0 — влево (вперед). Короткий жест — на месте.
export function stepAfterSwipe(step, dx, total, threshold = 40) {
  if (Math.abs(dx) < threshold) return step
  const next = dx < 0 ? step + 1 : step - 1
  return Math.min(Math.max(next, 0), total - 1)
}
