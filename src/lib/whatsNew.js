// «Что нового» — чистая логика (v6.4.0), без React/Dexie/сети.
//
// Отметка «эту версию уже видел» живет на УСТРОЙСТВЕ (localStorage), без синка:
// обновление ставится на конкретный телефон, и лист должен всплыть на каждом
// обновившемся, а не один раз на учетку (решение 03.08 из бэклога).

export const SEEN_KEY = 'kachalka:whats_new_seen'       // показан лист A
export const OPENED_KEY = 'kachalka:whats_new_opened'   // открыт экран «Обновления»

// '6.10.0' > '6.9.3': сравниваем по числам, а не строкой.
export function cmpVersion(a, b) {
  const pa = String(a ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

// Что показать листом после обновления.
//   seen === null — отметки на устройстве еще нет:
//     • knownDevice (здесь уже входили — сессия была до запуска) → только самая
//       свежая запись: так «Что нового» увидят и все, кто обновился на 6.4.0, где
//       отметки появились впервые;
//     • иначе (новый человек / новый телефон) → { show: [] } и версию запоминаем
//       МОЛЧА — новичку не нужна чужая история;
//   seen есть — записи новее seen и не новее текущей сборки (свежие сверху).
export function pendingWhatsNew(entries, seen, current, { knownDevice = false } = {}) {
  if (seen == null || seen === '') {
    if (!knownDevice) return { show: [], markSeen: current }
    const latest = (entries ?? []).find((e) => cmpVersion(e.version, current) <= 0)
    return latest ? { show: [latest], markSeen: null } : { show: [], markSeen: current }
  }
  const show = (entries ?? []).filter(
    (e) => cmpVersion(e.version, seen) > 0 && cmpVersion(e.version, current) <= 0,
  )
  return { show, markSeen: show.length ? null : (cmpVersion(current, seen) > 0 ? current : null) }
}

// Свести несколько пропущенных записей в один лист: главное из всех (по порядку,
// свежие первыми), остальное — в «мелочи». Версия/дата — самой свежей.
export function mergeForSheet(show, { maxMain = 4 } = {}) {
  if (!show?.length) return null
  const all = show.flatMap((e) => e.main ?? [])
  const main = all.slice(0, maxMain)
  const minor = [...all.slice(maxMain), ...show.flatMap((e) => e.minor ?? [])]
  return { version: show[0].version, date: show[0].date, main, minor, count: show.length }
}

// Метка «новое» у строки «Что нового» в Настройках: свежая запись еще не открыта.
export function hasUnopened(entries, opened) {
  const latest = entries?.[0]?.version
  if (!latest) return false
  return !opened || cmpVersion(latest, opened) > 0
}

// Заголовок для строки новой версии (version.json): headline + «и еще N».
export function updateHeadline(entry) {
  if (!entry) return null
  const n = (entry.main?.length ?? 0) + (entry.minor?.length ?? 0)
  const base = entry.headline ?? entry.main?.[0]?.t ?? ''
  const rest = n - 2
  return rest > 0 ? `${base} и еще ${rest}` : base
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря']

// '2026-10-01' → '1 октября'
export function fmtWhatsNewDate(ymd) {
  const [, m, d] = String(ymd ?? '').split('-').map(Number)
  if (!m || !d) return ''
  return `${d} ${MONTHS[m - 1]}`
}

// Безопасные чтение/запись localStorage (приватный режим Safari бросает).
export function readMark(key, storage = globalThis.localStorage) {
  try { return storage?.getItem(key) ?? null } catch { return null }
}
export function writeMark(key, value, storage = globalThis.localStorage) {
  try { storage?.setItem(key, value) } catch { /* приватный режим — переживем */ }
}
