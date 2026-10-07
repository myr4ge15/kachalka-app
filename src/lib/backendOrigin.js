// Адрес бэкенда, если это НЕ *.supabase.co (v6.16.2). Клиент ходит в Supabase по
// VITE_SUPABASE_URL, а там может стоять прокси — Cloudflare Worker на случай, когда
// *.supabase.co из РФ недоступен (supabase/proxy-deploy.md). Тогда:
//   - origin прокси нужно разрешить в CSP index.html (img-src, connect-src https + wss),
//     иначе браузер режет все запросы к нему;
//   - рантайм-кэш аватаров (Workbox) должен узнавать его адрес;
//   - ключ сессии в localStorage нельзя выводить из адреса: supabase-js по умолчанию
//     берет `sb-<первая метка хоста>-auth-token`, и смена адреса разлогинила бы всех.
// Чистая логика: CSP и кэш собирает vite.config.js на сборке, ключ — db/supabase.js.

const SUPABASE_HOST = /\.supabase\.co$/i

// Хост прокси (с портом, если он есть) или null: адрес пустой, кривой, не https или
// это сам Supabase — его CSP и кэш покрывают шаблоном *.supabase.co.
export function proxyHost(url) {
  if (!url) return null
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || SUPABASE_HOST.test(u.hostname)) return null
  return u.host
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Шаблон публичных аватаров для Workbox. Заякорен на начало ПОЛНОГО URL: для
// кросс-доменных запросов Workbox принимает только совпадение с позиции 0.
export function avatarCachePattern(url) {
  const host = proxyHost(url)
  const hosts = host ? `(?:[^/]+\\.supabase\\.co|${escapeRe(host)})` : '[^/]+\\.supabase\\.co'
  return new RegExp(`^https:\\/\\/${hosts}\\/storage\\/v1\\/object\\/public\\/avatars\\/`)
}

const CSP_META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/

// Дописывает origin прокси в CSP из index.html. Без прокси html не меняется. CSP не
// нашлась — бросаем: тихая сборка без разрешения прокси = приложение без сети.
export function withBackendCsp(html, url) {
  const host = proxyHost(url)
  if (!host) return html
  if (!CSP_META.test(html)) throw new Error('backendOrigin: в index.html не найден мета-тег CSP')
  return html.replace(CSP_META, (_, head, csp, tail) => {
    const policy = csp
      .split(';')
      .map((d) => {
        const name = d.trim().split(/\s+/)[0]
        if (name === 'img-src') return `${d} https://${host}`
        if (name === 'connect-src') return `${d} https://${host} wss://${host}`
        return d
      })
      .join(';')
    return head + policy + tail
  })
}

// Ключ сессии Supabase Auth. Задан ref проекта (VITE_SUPABASE_REF) — ключ тот же, что
// supabase-js ставит для https://<ref>.supabase.co, и переезд на прокси сессии не
// теряет. Не задан — null: остается умолчание supabase-js (как до v6.16.2).
export function authStorageKey(ref) {
  const r = String(ref ?? '').trim()
  return /^[a-z0-9]+$/i.test(r) ? `sb-${r}-auth-token` : null
}
