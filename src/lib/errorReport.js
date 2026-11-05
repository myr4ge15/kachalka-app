// Отчеты об ошибках клиента (Hawk) — чистая часть.
// Без SDK (v1.7.2): свой тонкий отправитель ради контроля над тем, что уходит наружу. Приложение
// хранит вес тела, имена и одноразовые токены в адресе (#reset=, #join=, #friend=), и стандартный
// SDK по умолчанию собирает URL, хлебные крошки и тексты запросов. Здесь уходит только:
// тип и текст ошибки (с вычисткой секретов), стек, версия, окружение, адрес БЕЗ query и hash,
// случайный id устройства (не учетки). Отправка — lib/errorReporter.js, подключение — main.jsx.
// Без VITE_HAWK_TOKEN ничего не делается.

const MAX_TEXT = 300
const MAX_FRAMES = 30

// Токен Hawk — base64 JSON; integrationId проверяем до включения в имя хоста.
export function parseHawkToken(token) {
  try {
    const { integrationId, secret } = JSON.parse(atob(String(token).trim()))
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
    if (!uuid.test(integrationId) || !uuid.test(secret)) return null
    return { host: `${integrationId}.k1.hawk.so` }
  } catch {
    return null
  }
}

export function collectorUrl(parsed) {
  return `https://${parsed.host}`
}

const CSP_META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/

// Разрешает хост приемника в connect-src. токена нет или он некорректен — html не меняется; CSP не найдена
// при заданном токене — бросаем (иначе сборка молча режет отчеты).
export function withReportCsp(html, token) {
  const parsed = parseHawkToken(token)
  if (!parsed) return html
  if (!CSP_META.test(html)) throw new Error('errorReport: в index.html не найден мета-тег CSP')
  return html.replace(CSP_META, (_, head, csp, tail) => {
    const policy = csp
      .split(';')
      .map((d) => (d.trim().split(/\s+/)[0] === 'connect-src' ? `${d} https://${parsed.host}` : d))
      .join(';')
    return head + policy + tail
  })
}

// Секреты в тексте ошибки: JWT, email, значения после #reset=/#join=/#friend=, длинные токены.
export function scrubText(text) {
  return String(text ?? '')
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '[jwt]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/([#?&](?:reset|join|friend|token|code|access_token|refresh_token)=)[^\s&"')]+/gi, '$1[x]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .slice(0, MAX_TEXT)
}

// Адрес без query и hash (в них лежат одноразовые секреты).
export function scrubUrl(url) {
  try {
    const u = new URL(url)
    return u.origin + u.pathname
  } catch {
    return String(url ?? '').split(/[?#]/)[0]
  }
}

const V8_FRAME = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/
const GECKO_FRAME = /^(.*?)@(.+?):(\d+):(\d+)\s*$/

// Стек строкой (V8 / Safari / Firefox) → кадры Sentry: от старого вызова к новому, адреса чистые.
export function parseStack(stack) {
  const frames = []
  for (const line of String(stack ?? '').split('\n')) {
    const m = V8_FRAME.exec(line) || GECKO_FRAME.exec(line)
    if (!m) continue
    frames.push({
      function: m[1] || '?',
      filename: scrubUrl(m[2]),
      abs_path: scrubUrl(m[2]),
      lineno: Number(m[3]),
      colno: Number(m[4]),
    })
  }
  return frames.slice(0, MAX_FRAMES).reverse()
}

// Шум, который не лечится кодом: офлайн, расширения браузера, отмененные запросы.
const NOISE = [
  /ResizeObserver loop/i,
  /Failed to fetch|Load failed|NetworkError|network request failed|Importing a module script failed/i,
  /\bAbortError\b|The operation was aborted|signal is aborted/i,
]
const EXT_FRAME = /^(chrome|moz|safari-web|safari)-extension:/

export function shouldIgnore(type, value, frames = []) {
  const text = `${type ?? ''} ${value ?? ''}`
  if (NOISE.some((re) => re.test(text))) return true
  const top = frames[frames.length - 1]
  return Boolean(top && EXT_FRAME.test(top.filename))
}

function normalize(error) {
  if (error && typeof error === 'object' && 'message' in error) {
    return { type: error.name || 'Error', value: error.message, stack: error.stack }
  }
  return { type: 'NonError', value: typeof error === 'string' ? error : safeJson(error), stack: '' }
}

function safeJson(v) {
  try { return JSON.stringify(v) } catch { return String(v) }
}

// Событие для отправки или null, если ошибку надо проигнорировать. Время и id — снаружи (тестируемо).
export function buildEvent(error, ctx) {
  const { type, value, stack } = normalize(error)
  const frames = parseStack(stack)
  if (shouldIgnore(type, value, frames)) return null
  return {
    event_id: ctx.eventId,
    timestamp: ctx.timestamp,
    platform: 'javascript',
    level: 'error',
    release: ctx.release,
    environment: ctx.environment,
    exception: {
      values: [{
        type,
        value: scrubText(value),
        mechanism: { type: ctx.source || 'generic', handled: Boolean(ctx.handled) },
        ...(frames.length ? { stacktrace: { frames } } : {}),
      }],
    },
    tags: ctx.tags || {},
    user: ctx.deviceId ? { id: ctx.deviceId } : undefined,
    request: ctx.url ? { url: scrubUrl(ctx.url) } : undefined,
  }
}

// Протокол Hawk. На входе только уже очищенные поля buildEvent, без исходного Error.
export function toHawkMessage(event, token) {
  const error = event.exception.values[0]
  return {
    token,
    catcherType: 'errors/javascript',
    payload: {
      title: error.value,
      type: scrubText(error.type),
      release: event.release,
      backtrace: [...(error.stacktrace?.frames || [])].reverse().map((frame) => ({
        file: frame.filename,
        line: frame.lineno,
        column: frame.colno,
        function: scrubText(frame.function),
      })),
      user: event.user,
      context: {
        environment: event.environment,
        url: event.request?.url,
        source: error.mechanism.type,
        handled: error.mechanism.handled,
        ...event.tags,
      },
    },
  }
}

// Предохранитель: не больше `max` отчетов за сессию, одинаковые — не чаще раза в `dedupeMs`.
export function createLimiter({ max = 10, dedupeMs = 60_000 } = {}) {
  let sent = 0
  const seen = new Map()
  return (key, now) => {
    if (sent >= max) return false
    const last = seen.get(key)
    if (last !== undefined && now - last < dedupeMs) return false
    seen.set(key, now)
    sent += 1
    return true
  }
}
