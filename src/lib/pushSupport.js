// Веб-пуши (v6.6.0): чистая логика без сети, Dexie и React. Браузерные факты
// (поддержка, iOS, «установлено на экран Домой», разрешение) собирает
// db/push.js и передаёт сюда готовыми значениями — так логику легко тестировать.

// Что показать в Настройках вместо/вместе с переключателем:
//   'off'         — ключ VAPID не задан в сборке: функции нет, строку не рисуем;
//   'ios-install' — iPhone/iPad в обычной вкладке Safari: пуши доступны только
//                   приложению, добавленному на экран «Домой» (iOS 16.4+);
//   'unsupported' — браузер не умеет пуши;
//   'denied'      — уведомления запрещены в настройках браузера/телефона;
//   'ok'          — можно включать и выключать.
export function pushAvailability({ configured, supported, isIOS, standalone, permission }) {
  if (!configured) return 'off'
  if (isIOS && !standalone) return 'ios-install'
  if (!supported) return 'unsupported'
  if (permission === 'denied') return 'denied'
  return 'ok'
}

// Компьютер (v7.1.4): пуши там — дубль телефона, поэтому строку в Настройках и
// стартовый лист «Включить уведомления?» не показываем ('off'). Исключение —
// пуши в ЭТОМ браузере уже включены: строка остается, чтобы их можно было
// выключить. Типы пушей хранятся на сервере на всю учетку — их настраивают с телефона.
export function desktopAvailability(availability, { desktop = false, enabled = false } = {}) {
  return desktop && !enabled ? 'off' : availability
}

// Признак компьютера — основной указатель мышь (а не ширина окна): планшет в
// альбомной ориентации и телефон остаются «телефоном».
export const DESKTOP_QUERY = '(hover: hover) and (pointer: fine)'

// iPhone/iPad. iPadOS 13+ в Safari представляется «Macintosh», отличаем по тачу.
export function isIOSDevice({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  return platform === 'MacIntel' && maxTouchPoints > 1
}

// VAPID-ключ приходит строкой base64url, подписке нужен массив байт.
export function urlB64ToUint8Array(b64) {
  const s = String(b64 ?? '').trim()
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Подписка браузера сделана под ДРУГОЙ VAPID-ключ (ключ в сборке сменили)?
// Такую push-сервис отвергает (обычно 403), пуши молча не доходят, а клиент раньше
// переиспользовал ее вечно (РЕВЬЮ-КОДА-2026-10-02, мелочи). subKey —
// `sub.options.applicationServerKey` (ArrayBuffer, бывает null/нет вовсе в старых
// браузерах), expected — байты ключа сборки. Ключ подписки неизвестен → false:
// пересоздавать вслепую нельзя (лишний запрос разрешения/подписки на каждом входе).
export function isStaleServerKey(subKey, expected) {
  const a = toBytes(subKey)
  const b = toBytes(expected)
  if (!a || !b || b.length === 0) return false
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true
  return false
}

function toBytes(v) {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  return null
}

// Подписка браузера (PushSubscription.toJSON()) → аргументы push_subscribe.
// Неполная подписка → null: такую на сервер не отправляем.
export function subscriptionArgs(json, userAgent = '') {
  const endpoint = json?.endpoint
  const p256dh = json?.keys?.p256dh
  const auth = json?.keys?.auth
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return null
  if (!p256dh || !auth) return null
  return {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: String(userAgent).slice(0, 300) || null,
  }
}

// Подпись под строкой «Пуш-уведомления» — только когда включить отсюда нельзя
// и надо объяснить, что сделать. В обычном состоянии строка без подписи (v6.6.1).
export function pushSubtitle(availability) {
  switch (availability) {
    case 'ios-install':
      return 'На iPhone — только из приложения на экране «Домой»: «Поделиться» → «На экран „Домой“», потом открой с иконки'
    case 'unsupported':
      return 'Этот браузер не умеет пуш-уведомления'
    case 'denied':
      return 'Запрещены в настройках браузера или телефона — разреши там и вернись сюда'
    default:
      return ''
  }
}

// Подпись строки «Пуш-уведомления» в Настройках (v7.1.4): сами тумблеры живут на
// отдельном экране, а строка коротко говорит, что там сейчас.
export function pushRowSubtitle({ availability, enabled = false, prefs = null } = {}) {
  switch (availability) {
    case 'ios-install': return 'на iPhone — из приложения на экране «Домой»'
    case 'unsupported': return 'этот браузер их не умеет'
    case 'denied': return 'запрещены в настройках браузера или телефона'
    case 'ok': {
      if (!enabled) return 'выключены'
      if (prefs === null) return 'включены'
      const on = PUSH_TYPES.filter((t) => isPushTypeOn(prefs, t.type)).length
      return `включены · ${on} из ${PUSH_TYPES.length}`
    }
    default: return ''
  }
}

// Разовый вопрос «Включить уведомления?» после входа (v6.6.1). Спрашиваем, только
// если включить реально можно одним нажатием и человек еще не отвечал: браузер ни
// разу не спрашивал разрешение (permission 'default'), подписки нет, а на этом
// устройстве этой учетке мы вопрос еще не показывали. Запрос разрешения браузера
// сам по себе без нажатия не работает (Safari) или прячется (Chrome), поэтому
// сначала наш лист с кнопкой, а уже по ней — системный запрос.
export function shouldAskPush({ availability, permission, enabled, asked }) {
  return availability === 'ok' && permission === 'default' && !enabled && !asked
}

// Типы пуш-уведомлений (v6.7.0) — ключи настроек на сервере (push_prefs,
// supabase/push-types.sql) и тип в Edge Functions (_shared/webpush.ts PushType).
// Порядок = порядок тумблеров в Настройках.
export const PUSH_TYPES = [
  { type: 'reaction', emoji: '💬', label: 'Реакции на мои тренировки' },
  { type: 'record', emoji: '🏆', label: 'Побили мой рекорд' },
  { type: 'overtake', emoji: '🥇', label: 'Обогнали в рейтинге' },
  { type: 'reminder', emoji: '⏰', label: 'Напоминание о тренировке', sub: 'если 3 дня без зала — в 18:00' },
  { type: 'update', emoji: '📲', label: 'Новая версия приложения' },
]

// Включен ли тип. На сервере хранятся только явно заданные значения: нет ключа —
// включено (по умолчанию все включено, решение 01.10).
export function isPushTypeOn(prefs, type) {
  return prefs?.[type] !== false
}
