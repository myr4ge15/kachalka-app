// «Что нового» — чистая логика (v6.4.0), без React/Dexie/сети.
//
// Отметка «эту версию уже видел» живет на УСТРОЙСТВЕ (localStorage), без синка:
// обновление ставится на конкретный телефон, и лист должен всплыть на каждом
// обновившемся, а не один раз на учетку (решение 03.08 из бэклога).

// Эпоха нумерации (v1.0.0 э2, docs/plans/PLAN-version-reset.md): номер свернули с 9.6.0
// на 1.0.0. Метки ниже сравниваются «больше/меньше», поэтому у эпохи 2 — свои ключи:
// на знакомом устройстве новой метки нет → покажется свежая запись (как при первом
// запуске 6.4.0), новичку — молча. Эпоха уходит и в version.json (Edge push-update).
import { plural } from './plural.js'
export const VERSION_EPOCH = 2
export const SEEN_KEY = 'kachalka:whats_new_seen.e2'       // показан лист A
export const OPENED_KEY = 'kachalka:whats_new_opened.e2'   // открыт экран «Обновления»

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

// Записи текущей эпохи. Старые (epoch: 1 — номера до 1.0.0 э2) живут только в истории
// экрана «Обновления»: сравнивать их с номерами эпохи 2 нельзя (9.6.0 «новее» 1.2.0).
export function ofEpoch(entries, epoch = VERSION_EPOCH) {
  return (entries ?? []).filter((e) => (e.epoch ?? VERSION_EPOCH) === epoch)
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
  const mine = ofEpoch(entries)
  if (seen == null || seen === '') {
    if (!knownDevice) return { show: [], markSeen: current }
    const latest = mine.find((e) => cmpVersion(e.version, current) <= 0)
    return latest ? { show: [latest], markSeen: null } : { show: [], markSeen: current }
  }
  const show = mine.filter(
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
  const latest = ofEpoch(entries)[0]?.version
  if (!latest) return false
  return !opened || cmpVersion(latest, opened) > 0
}

// version.json (vite.config.js): версия на сервере + заголовок свежей записи, если она
// про эту версию. push: false у записи (v7.5.0) → silent: push-update запишет версию как
// объявленную, но пуш «Вышла версия» не пошлет (вся линейка x.y — тихо). epoch (v1.0.0 э2) —
// эпоха нумерации для сравнения версий на сервере.
export function versionJson(entries, version, epoch = VERSION_EPOCH) {
  const latest = entries?.[0]?.version === version ? entries[0] : null
  return { version, epoch, headline: updateHeadline(latest), ...(latest?.push === false ? { silent: true } : {}) }
}

// Заголовок для строки новой версии и пуша «Вышла версия» (version.json): headline + « — и еще N улучшений».
// Через тире (fb_f8deafbe): «Комментарии пузырями и реакции и еще 8» — два «и» подряд, и непонятно, чего 8.
export function updateHeadline(entry) {
  if (!entry) return null
  const n = (entry.main?.length ?? 0) + (entry.minor?.length ?? 0)
  const base = entry.headline ?? entry.main?.[0]?.t ?? ''
  const rest = n - 2
  return rest > 0 ? `${base} — и еще ${rest} ${plural(rest, 'улучшение', 'улучшения', 'улучшений')}` : base
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
