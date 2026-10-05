// ============================================================================
// «Написать разработчику» (v6.11.0) — чистая логика: контекст обращения,
// статусы, метка «новый ответ», тексты ошибок. Без сети и DOM — сеть в
// lib/feedbackApi.js, сервер — supabase/feedback.sql + Edge Function feedback.
// ============================================================================

export const FEEDBACK_MAX = 2000

// Статусы бэклога обращений (совпадают с check в feedback.sql).
export const FEEDBACK_STATUSES = ['new', 'in_progress', 'resolved', 'declined']
export const STATUS_LABEL = {
  new: 'Новое',
  in_progress: 'В работе',
  resolved: 'Решено',
  declined: 'Не будем делать',
}
export const isOpenStatus = (s) => s === 'new' || s === 'in_progress'

// Экран, с которого пишут, — человеческим словом (в Telegram и в админке).
const SCREEN_LABEL = {
  home: 'Главная', history: 'Тренировки', feed: 'Лента', progress: 'Прогресс',
  profile: 'Профиль', notif: 'Уведомления', admin: 'Админка', freshness: 'Восстановление',
  myex: 'Каталог', achievements: 'Достижения', appearance: 'Оформление',
  whatsnew: 'Что нового', member: 'Профиль друга', feedback: 'Обратная связь',
}

// Движок WebKit 26+ (Safari/PWA на iOS 26). С iOS 26 Apple «заморозила» версию
// системы в userAgent на 18.x (у пользователя на iOS 26.6.2 приходило «iOS 18.7»),
// а в PWA с экрана «Домой» нет и токена Version/26. Отличаем по возможностям,
// которые появились только в Safari 26: якорное позиционирование и анимации по
// прокрутке. Настоящие iOS 18.6/18.7 (обновления для старых iPhone) их не умеют.
export function isWebKit26Plus(css = globalThis.CSS) {
  try {
    return Boolean(css?.supports?.('anchor-name: --a') || css?.supports?.('animation-timeline: scroll()'))
  } catch {
    return false
  }
}

// Версия iOS из userAgent с поправкой на заморозку (см. isWebKit26Plus):
//  • есть Version/26.x (Safari-браузер) — берем ее, она настоящая;
//  • OS 18.6+ и движок 26+ (PWA) — «26+»: точнее страница узнать не может.
function iosVersion(major, minor, s, modernWebKit) {
  if (Number(major) === 18) {
    const v = /Version\/(\d+)(?:\.(\d+))?/.exec(s)
    if (v && Number(v[1]) >= 26) return v[2] ? `${v[1]}.${v[2]}` : v[1]
    if (Number(minor) >= 6 && modernWebKit) return '26+'
  }
  return `${major}.${minor}`
}

// Короткое описание устройства из userAgent: «iPhone · iOS 17.5», «Android 14 · Chrome 129»,
// «Windows · Edge 129». Не идеально и не обязано быть — это подсказка для разбора бага.
// modernWebKit — результат isWebKit26Plus() на устройстве (по одному UA не понять).
export function describeDevice(ua = '', { modernWebKit = false } = {}) {
  const s = String(ua)
  let os = ''
  let m
  if ((m = /\b(iPhone|iPad|iPod)\b.*?OS (\d+)[_.](\d+)/.exec(s))) os = `${m[1]} · iOS ${iosVersion(m[2], m[3], s, modernWebKit)}`
  else if (/\biPad\b/.test(s)) os = 'iPad'
  else if ((m = /Android (\d+(?:\.\d+)?)/.exec(s))) os = `Android ${m[1]}`
  else if (/Macintosh|Mac OS X/.test(s)) os = 'Mac'
  else if (/Windows/.test(s)) os = 'Windows'
  else if (/Linux/.test(s)) os = 'Linux'

  let br = ''
  if ((m = /\b(?:EdgA?|Edg)\/(\d+)/.exec(s))) br = `Edge ${m[1]}`
  else if ((m = /YaBrowser\/(\d+)/.exec(s))) br = `Яндекс ${m[1]}`
  else if ((m = /SamsungBrowser\/(\d+)/.exec(s))) br = `Samsung ${m[1]}`
  else if ((m = /(?:CriOS|Chrome)\/(\d+)/.exec(s))) br = `Chrome ${m[1]}`
  else if ((m = /(?:FxiOS|Firefox)\/(\d+)/.exec(s))) br = `Firefox ${m[1]}`
  else if ((m = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(s))) br = `Safari ${m[1]}`
  // На iPhone/iPad движок всегда WebKit, браузер почти всегда Safari — не дублируем.
  if (/^(iPhone|iPad|iPod)/.test(os) && br.startsWith('Safari')) br = ''
  return [os, br].filter(Boolean).join(' · ') || 'неизвестно'
}

// Что приложение само кладет к обращению. Только то, что помогает разобрать баг;
// никаких персональных данных сверх того, что сервер и так знает (автор — из сессии).
// screen — откуда пришли к форме: вкладка, с которой открыли Настройки (v6.11.1;
// сама форма живет в Настройках, и раньше здесь всегда было «Профиль»).
export function buildContext({ version, userAgent, modernWebKit, standalone, viewport, screen, online } = {}) {
  const ctx = {
    version: String(version ?? ''),
    device: describeDevice(userAgent, { modernWebKit }),
    standalone: Boolean(standalone),
    screen: SCREEN_LABEL[screen] ?? (screen ? String(screen).slice(0, 30) : ''),
  }
  if (viewport?.w && viewport?.h) ctx.viewport = `${Math.round(viewport.w)}×${Math.round(viewport.h)}`
  if (online === false) ctx.online = false
  return ctx
}

export function cleanBody(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').trim()
}

// Можно ли отправлять: текст 1..2000 после обрезки.
export function bodyProblem(text) {
  const t = cleanBody(text)
  if (!t) return 'empty'
  if (t.length > FEEDBACK_MAX) return 'too_long'
  return null
}

// Ответ есть и автор его еще не видел.
export function hasUnreadReply(row) {
  if (!row?.reply || !row.replied_at) return false
  if (!row.reply_seen_at) return true
  return new Date(row.reply_seen_at) < new Date(row.replied_at)
}

export function unreadReplies(rows) {
  return (rows ?? []).filter(hasUnreadReply).length
}

// Строка «открытые / всего» для заголовка админского раздела.
export function openCount(rows) {
  return (rows ?? []).filter((r) => isOpenStatus(r.status)).length
}

// Коды ошибок Edge/RPC → текст для человека.
export function feedbackErrorText(code) {
  switch (code) {
    case 'empty': return 'Напиши, что случилось или что хочется улучшить.'
    case 'too_long': return `Слишком длинно — до ${FEEDBACK_MAX} символов.`
    case 'rate_limited': return 'Много обращений подряд. Попробуй через час.'
    case 'forbidden': case 'no_session': return 'Сессия завершилась. Войди заново.'
    case 'not_found': return 'Обращение не найдено.'
    case 'not_deployed': return 'Обратная связь пока не включена на сервере.'
    case 'offline': return 'Нет связи. Отправь, когда появится интернет.'
    case 'shot_failed': return 'Не удалось загрузить скриншот. Попробуй без него или другой файл.'
    default: return 'Не получилось отправить. Проверь связь и попробуй еще раз.'
  }
}

// «05.10 14:32» — локальное время.
export function fmtFeedbackDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Контекст обращения одной строкой для админки (зеркало contextLine в Edge).
export function contextLine(ctx = {}) {
  return [
    ctx.version ? `v${ctx.version}` : '',
    typeof ctx.device === 'string' ? ctx.device : '',
    ctx.standalone === true ? 'PWA' : ctx.standalone === false ? 'браузер' : '',
    ctx.viewport ? String(ctx.viewport) : '',
    ctx.screen ? `открыто с: ${ctx.screen}` : '',
    ctx.online === false ? 'офлайн' : '',
  ].filter(Boolean).join(' · ')
}
