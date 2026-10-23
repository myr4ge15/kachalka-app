import { fmtNum } from './metric.js'

export const FEEDBACK_SHOTS_MAX = 5
// ============================================================================
// «Написать разработчику» (v6.11.0) — чистая логика: контекст обращения,
// статусы, метка «новый ответ», тексты ошибок. Без сети и DOM — сеть в
// lib/feedbackApi.js, сервер — supabase/feedback.sql + Edge Function feedback.
// ============================================================================

export const FEEDBACK_MAX = 2000

// Видео к обращению (16.10, fb_1c5fab9c): MP4/MOV, лежит в том же списке вложений, что и скриншоты
// (всего до 5), без сжатия. Предел — 50 МБ (19.10, fb_2bd2021d): столько бот отправляет в Telegram.
// Было 20 МБ (столько бот скачивает обратно), но iPhone при выборе из «Фото» перекодирует HEVC-запись
// экрана в H.264, и 12,9 МБ в «Фото» приходили файлом больше 20 МБ. Видео больше 20 МБ разработчик
// получает в Telegram, а в приложении его плитка остается недоступной (getFile отдает до 20 МБ).
export const FEEDBACK_VIDEO_MAX_BYTES = 50 * 1024 * 1024
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' }
// Расширение пути в Storage: 'mp4' | 'mov' для видео, null — не видео (или формат не тот).
export function videoExt(file) {
  const type = String(file?.type ?? '').toLowerCase()
  if (VIDEO_TYPES[type]) return VIDEO_TYPES[type]
  const m = /\.(mp4|mov)$/i.exec(String(file?.name ?? ''))
  return type.startsWith('video/') || !type ? (m ? m[1].toLowerCase() : null) : null
}
export const isVideoFile = (file) => String(file?.type ?? '').toLowerCase().startsWith('video/') || videoExt(file) !== null
// Что можно приложить: null — можно, иначе код для feedbackErrorText.
export function attachmentProblem(file) {
  if (isVideoFile(file)) {
    if (!videoExt(file)) return 'video_format'
    if (Number(file.size) > FEEDBACK_VIDEO_MAX_BYTES) return 'video_too_big'
    return null
  }
  return String(file?.type ?? '').startsWith('image/') ? null : 'shot_format'
}
// Ссылки (object URL) вложений, оказавшихся видео: их отмечает feedbackApi.feedbackMedia,
// плитка обращения по ним рисует <video> вместо <img>.
const videoUrls = new Set()
export const markVideoMedia = (url) => { videoUrls.add(url) }
export const isVideoMedia = (url) => videoUrls.has(url)
export const clearVideoMedia = () => { videoUrls.clear() }
// iPhone не рисует кадр <video preload=metadata> из blob-ссылки — плитка черная, и непонятно, приложилось ли
// видео (fb_59c95046). Фрагмент #t=0.1 просит Safari показать кадр с этой секунды.
export const videoPosterSrc = (url) => (url ? url + '#t=0.1' : url)
// Текст отказа во вложении: у слишком большого видео — его настоящий размер, который отдал телефон
// (fb_2bd2021d: «в смысле больше 20 МБ?» — в «Фото» было 12,9 МБ).
export function attachmentProblemText(file) {
  const code = attachmentProblem(file)
  if (code !== 'video_too_big') return code ? feedbackErrorText(code) : ''
  return 'Видео ' + fmtFileSize(file.size) + ' — больше 50 МБ. iPhone при отправке пересжимает запись,'
    + ' и она выходит больше, чем в «Фото». Обрежь ее или запиши покороче.'
}
// «2,3 МБ» — подпись видео в форме.
// Мегабайты — десятичные, как в «Фото» и «Файлах» iPhone (23.10.2026, владелец: видео 13,8 МБ на телефоне
// в приложении показывалось как 13,2 — делили на 1024²).
export function fmtFileSize(bytes) {
  const mb = Number(bytes) / 1e6
  if (!(mb > 0)) return ''
  return mb < 0.1 ? '0,1 МБ' : fmtNum(Math.round(mb * 10) / 10) + ' МБ'
}

// Тип по первым байтам: Edge отдает вложение как octet-stream, а <video> на iPhone без
// типа не играет. MP4/MOV — коробка ftyp на 4-м байте (бренд «qt  » — QuickTime).
export function sniffMediaType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? [])
  const at = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0))
  if (b.length >= 12 && at(4, 'ftyp')) return at(8, 'qt  ') ? 'video/quicktime' : 'video/mp4'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && at(0, '\x89PNG')) return 'image/png'
  return null
}

// Статусы бэклога обращений (совпадают с check в feedback.sql).
export const FEEDBACK_STATUSES = ['new', 'in_progress', 'resolved', 'declined']
export const STATUS_LABEL = {
  new: 'Новое',
  in_progress: 'В работе',
  resolved: 'Решено',
  declined: 'Не будем делать',
}
export const isOpenStatus = (s) => s === 'new' || s === 'in_progress'
export const isFinalStatus = (s) => s === 'resolved' || s === 'declined'

// Переоткрытие автором (v6.12.0): комментарий до 1000 символов, не больше 3 раз
// (те же пороги проверяет reopen_my_feedback на сервере).
export const REOPEN_MAX = 1000
export const REOPEN_LIMIT = 3

// Дополнение к открытому обращению (v8.6.0): до 1000 символов, не больше 5 на
// обращение (те же пороги проверяет append_my_feedback, supabase/feedback-append.sql).
export const APPEND_MAX = 1000
export const APPEND_LIMIT = 5

// Экран, с которого пишут, — человеческим словом (в Telegram и в админке).
const SCREEN_LABEL = {
  home: 'Главная', history: 'Тренировки', feed: 'Лента', progress: 'Прогресс',
  profile: 'Профиль', notif: 'Уведомления', admin: 'Админка', freshness: 'Восстановление',
  myex: 'Каталог', achievements: 'Достижения', appearance: 'Оформление', pushset: 'Пуш-уведомления',
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
// сама форма живет в Настройках, и раньше здесь всегда было «Профиль»). via — экран между
// ними («Лента → Профиль», fb_89880c2d).
const screenLabel = (s) => SCREEN_LABEL[s] ?? (s ? String(s).slice(0, 30) : '')
export function buildContext({ version, userAgent, modernWebKit, standalone, viewport, screen, via, online } = {}) {
  const ctx = {
    version: String(version ?? ''),
    device: describeDevice(userAgent, { modernWebKit }),
    standalone: Boolean(standalone),
    screen: via && via !== screen ? `${screenLabel(screen)} → ${screenLabel(via)}` : screenLabel(screen),
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

// Ответ — текст и/или фото из Telegram (v6.12.0: ответ может быть одними картинками).
export function hasReply(row) {
  return Boolean(row?.reply) || Number(row?.reply_photos) > 0
}

// Можно ли открыть обращение снова: решено/отклонено и лимит не исчерпан.
export function canReopen(row) {
  return isFinalStatus(row?.status) && Number(row?.reopen_count ?? 0) < REOPEN_LIMIT
}

// Можно ли дописать: обращение открыто (новое / в работе) и лимит не исчерпан.
// Решенное дописывать нельзя — для него «Не помогло — открыть снова».
export function canAppend(row) {
  return isOpenStatus(row?.status) && (row?.additions?.length ?? 0) < APPEND_LIMIT
}

export function appendProblem(text) {
  const t = cleanBody(text)
  if (!t) return 'empty'
  if (t.length > APPEND_MAX) return 'too_long'
  return null
}

export function reopenProblem(text) {
  const t = cleanBody(text)
  if (!t) return 'empty'
  if (t.length > REOPEN_MAX) return 'too_long'
  return null
}

// Ответы разработчика как пункты «Уведомлений» (v6.12.0). Источник — свои
// обращения (my_feedback), закэшированные на устройстве (db/feedbackReplies.js).
export function feedbackReplyNotifs(rows) {
  return (rows ?? [])
    .filter((r) => r?.id && r.replied_at && hasReply(r))
    .map((r) => ({
      id: `feedback:${r.id}`,
      type: 'feedback',
      feedbackId: r.id,
      at: r.replied_at,
      status: r.status,
      text: r.reply ? (r.reply.length > 140 ? r.reply.slice(0, 139) + '…' : r.reply) : '',
      photos: Number(r.reply_photos) || 0,
    }))
}

// Вложения по месту (fb_37f0c1a8): у приложенных после отправки есть время (times: { номер: ISO },
// feedback_screenshot_times). Такое вложение — к последнему дополнению, отправленному не позже него и
// не раньше чем за ATTACH_WINDOW_MS (форма шлет сначала текст, потом файлы); не нашлось — «добавлено
// позже» (файлы без текста). Без времени (все старые) — к самому обращению; приложенные вместе с
// исходным сообщением (форма шлет его, потом файлы: время ≈ createdAt) — тоже к нему (fb_d4103a75).
const ATTACH_WINDOW_MS = 10 * 60 * 1000
const CLOCK_SLACK_MS = 5000
export function groupAttachments(count, times = null, additions = [], createdAt = null) {
  const created = Date.parse(createdAt)
  const base = []
  const later = []
  const byAddition = {}
  const adds = (additions ?? [])
    .map((a) => ({ n: a.n, t: Date.parse(a.created_at) }))
    .filter((a) => Number.isFinite(a.t))
    .sort((x, y) => x.t - y.t)
  for (let i = 0; i < (Number(count) || 0); i++) {
    const at = Date.parse(times?.[i])
    if (!Number.isFinite(at)) { base.push(i); continue }
    const add = adds.filter((a) => a.t <= at + CLOCK_SLACK_MS && at - a.t <= ATTACH_WINDOW_MS).pop()
    if (add) (byAddition[add.n] ??= []).push(i)
    else if (Number.isFinite(created) && at - created <= ATTACH_WINDOW_MS) base.push(i)
    else later.push(i)
  }
  return { base, byAddition, later }
}

// Подпись вложений без своего дополнения (fb_9acbbfc6: «Добавлено позже» было непонятно) — когда
// приложены: «Приложенное 23.10, 12:02» (по первому из них).
export function laterLabel(times, later) {
  const at = later?.length ? times?.[later[0]] : null
  return at ? `Приложенное ${fmtFeedbackDate(at)}` : 'Приложенное отдельно'
}

// Ответ дан ДО последнего переоткрытия — это «прошлый ответ», а не решение.
export function isStaleReply(row) {
  if (!row?.reopened_at || !row?.replied_at) return false
  return new Date(row.replied_at) < new Date(row.reopened_at)
}

// Ответ есть и автор его еще не видел.
export function hasUnreadReply(row) {
  if (!hasReply(row) || !row.replied_at) return false
  if (!row.reply_seen_at) return true
  return new Date(row.reply_seen_at) < new Date(row.replied_at)
}

export function unreadReplies(rows) {
  return (rows ?? []).filter(hasUnreadReply).length
}

// «Мои обращения» (16.10): с какой вкладки открыть экран. Пришли пушем — вкладка этого
// обращения; есть непрочитанный ответ — вкладка первого такого; иначе открытые, если они есть.
export function myFeedbackTab(rows, focusId = null) {
  const list = rows ?? []
  const tabOf = (r) => (isOpenStatus(r.status) ? 'open' : 'closed')
  const focus = focusId && list.find((r) => r.id === focusId)
  if (focus) return tabOf(focus)
  const fresh = list.find(hasUnreadReply)
  if (fresh) return tabOf(fresh)
  return list.some((r) => isOpenStatus(r.status)) || !list.length ? 'open' : 'closed'
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
    case 'shot_limit': return 'К обращению можно приложить до 5 скриншотов.'
    case 'shot_failed': return 'Не удалось загрузить скриншот. Попробуй без него или другой файл.'
    case 'shot_format': return 'Можно приложить картинки или видео (MP4, MOV).'
    case 'video_format': return 'Видео — только MP4 или MOV (как снимает телефон).'
    case 'video_too_big': return 'Видео больше 50 МБ — обрежь его или запиши покороче.'
    case 'video_failed': return 'Не удалось загрузить видео. Попробуй еще раз или запиши покороче.'
    case 'upload_stalled': return 'Видео не загрузилось: связь слишком слабая. Попробуй на Wi-Fi или запиши покороче.'
    case 'reopen_limit': return `Обращение уже открывали снова ${REOPEN_LIMIT} раза — напиши новое.`
    case 'not_closed': return 'Обращение еще в работе — дождись ответа.'
    case 'append_limit': return `К обращению уже ${APPEND_LIMIT} дополнений — напиши новое.`
    case 'not_open': return 'Обращение уже закрыто — если не помогло, открой его снова.'
    // Сервер не принял вложение или запрос (fb_df730f74: видео упиралось в старую проверку) — это не связь.
    case 'bad_request': return 'Сервер не принял вложение. Попробуй отправить без него.'
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
  // v8.0.1: обращение из пересланного в бота сообщения (feedback-tg-forward.sql).
  const tg = ctx.source === 'telegram'
    ? `из Telegram${typeof ctx.tg_from === 'string' && ctx.tg_from ? ` (${ctx.tg_from})` : ''}`
    : ''
  return [
    tg,
    ctx.version ? `v${ctx.version}` : '',
    typeof ctx.device === 'string' ? ctx.device : '',
    ctx.standalone === true ? 'PWA' : ctx.standalone === false ? 'браузер' : '',
    ctx.viewport ? String(ctx.viewport) : '',
    ctx.screen ? `открыто с: ${ctx.screen}` : '',
    ctx.online === false ? 'офлайн' : '',
  ].filter(Boolean).join(' · ')
}
