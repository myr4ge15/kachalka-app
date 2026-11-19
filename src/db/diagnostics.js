import Dexie from 'dexie'

// Общее хранилище установки: одна транзакция отвечает за запись и вытеснение
// даже при нескольких открытых вкладках. В бюджет входят UTF-8 байты записей.
export const DIAGNOSTIC_BYTES = 256 * 1024
const journal = new Dexie('gym_app_diagnostics')
journal.version(1).stores({ events: '++id,owner,[owner+code]', meta: '' })
const encoder = new TextEncoder()
const size = (row) => encoder.encode(JSON.stringify(row)).length
let activeOwner = null

export function setDiagnosticOwner(owner) { activeOwner = owner }

// Сохраняем только класс и позицию кадра. URL, сообщение и стек могут содержать данные пользователя.
export function recordFailure(code, cause, owner = activeOwner) {
  const classes = ['TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AbortError',
    'QuotaExceededError', 'TransactionInactiveError', 'InvalidStateError', 'DatabaseClosedError',
    'UnknownError', 'NetworkError', 'TimeoutError']
  const type = classes.includes(cause?.name) ? cause.name : 'Error'
  const location = typeof cause?.stack === 'string' && cause.stack.split('\n').slice(1).join('\n').match(/:(\d{1,8}):(\d{1,8})\)?(?:\n|$)/)
  const position = location ? `.${location[1]}.${location[2]}` : ''
  return recordDiagnostic(`${code}.${type}${position}`, { owner, error: true })
}

export async function recordDiagnostic(code, { owner = activeOwner, error = false, at = Date.now() } = {}) {
  if (!owner || !/^[a-zA-Z0-9_.:-]{1,96}$/.test(code)) return
  try {
    await Dexie.ignoreTransaction(() => journal.transaction('rw', journal.events, journal.meta, async () => {
      const events = journal.events
      let bytes = (await journal.meta.get('bytes')) ?? 0
      const row = { owner, code, error, first: at, at, count: 1, version: __APP_VERSION__ }
      if (error) {
        const previous = await events.where('[owner+code]').equals([owner, code]).last()
        if (previous?.error && previous.version === row.version && at >= previous.at && at - previous.at <= 60_000) {
          row.first = previous.first
          row.count += previous.count
          await events.delete(previous.id)
          bytes -= size(previous)
        }
      }
      row.id = await events.add(row)
      bytes += size(row)
      while (bytes > DIAGNOSTIC_BYTES) {
        const oldest = await events.orderBy('id').first()
        await events.delete(oldest.id)
        bytes -= size(oldest)
      }
      await journal.meta.put(bytes, 'bytes')
    }))
  } catch { /* Недоступность диагностики не должна мешать работе приложения. */ }
}

export async function readDiagnostics(owner) {
  if (!owner) return []
  try {
    const rows = await journal.events.where('owner').equals(owner).toArray()
    const lastFailure = rows.findLastIndex((row) => row.error)
    const pivot = lastFailure < 0 ? rows.length - 1 : lastFailure
    // Ближайшие к сбою первыми: упаковка может оборваться на границе бюджета.
    const fragment = []
    for (let distance = 0; distance < 24; distance++) {
      for (const index of distance ? [pivot - distance, pivot + distance] : [pivot]) {
        const row = rows[index]
        if (row) fragment.push({ index, line: diagnosticLine(row) })
      }
    }
    return fragment
  } catch { return [] }
}

function diagnosticLine(row) {
  const time = new Date(row.at).toISOString()
  const repeated = row.count > 1 ? ` ×${row.count} (с ${new Date(row.first).toISOString()})` : ''
  return `${time} ${row.version} ${row.error ? '! ' : ''}${row.code}${repeated}`
}
