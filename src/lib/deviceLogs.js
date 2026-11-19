// Фрагмент диагностики ограничен бюджетом context. Старый формат свайпов и пушей
// поддерживается для ранее отправленных обращений.
import { swipeLogLine } from './swipeLog.js'

export const CONTEXT_MAX_BYTES = 3800 // сервер режет на 4000, запас — на неточность оценки
export const LOG_LINE_MAX = 200

// Размер так, как его считает Postgres (octet_length(jsonb::text)): jsonb печатает «, » и «: » с пробелом.
export function jsonbBytes(v) {
  const text = (x) => {
    if (Array.isArray(x)) return `[${x.map(text).join(', ')}]`
    if (x && typeof x === 'object') return `{${Object.entries(x).map(([k, y]) => `${JSON.stringify(k)}: ${text(y)}`).join(', ')}}`
    return JSON.stringify(x) ?? 'null'
  }
  return new TextEncoder().encode(text(v)).length
}

const pad = (n) => String(n).padStart(2, '0')
// Строка шага пуша: «23.10 13:40:05 sw click · /#feed».
export function pushLogLine(r) {
  const d = new Date(r?.at)
  const time = Number.isNaN(d.getTime()) ? '—'
    : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return [`${time} ${r?.who ?? '?'} ${r?.ev ?? ''}`.trim(), r?.detail ? String(r.detail) : null].filter(Boolean).join(' · ')
}

// ctx + журналы → новый ctx с logs, не больше maxBytes. swipes — свежие сверху (readSwipeLog),
// pushes — старые сверху (readPushLog). Пустые журналы — ctx без logs.
export function withDeviceLogs(ctx, { swipes = [], pushes = [], diagnostics = [] } = {}, maxBytes = CONTEXT_MAX_BYTES) {
  if (diagnostics.length) {
    const selected = []
    for (const row of diagnostics) {
      const candidate = [...selected, row]
      if (jsonbBytes({ ...ctx, logs: { diagnostic: candidate.map((r) => r.line) } }) > maxBytes) break
      selected.push(row)
    }
    if (selected.length) {
      selected.sort((a, b) => b.index - a.index)
      return { ...ctx, logs: { diagnostic: selected.map((r) => r.line) } }
    }
  }
  const queues = {
    swipe: swipes.map((e) => swipeLogLine(e).slice(0, LOG_LINE_MAX)),
    push: [...pushes].reverse().map((r) => pushLogLine(r).slice(0, LOG_LINE_MAX)),
  }
  const logs = { swipe: [], push: [] }
  const fits = () => jsonbBytes({ ...ctx, logs }) <= maxBytes
  let added = true
  while (added) {
    added = false
    for (const kind of ['swipe', 'push']) {
      const line = queues[kind].shift()
      if (line === undefined) continue
      logs[kind].push(line)
      if (fits()) added = true
      else { logs[kind].pop(); queues[kind] = [] } // не влезла — этот журнал дальше не берем
    }
  }
  if (!logs.swipe.length && !logs.push.length) return ctx
  return { ...ctx, logs }
}

// Текст журналов для Админки (и зеркало в Edge feedback logic.ts logsText). null — журналов нет.
export function logsText(logs) {
  if (!logs || typeof logs !== 'object') return null
  const part = (title, lines) => (Array.isArray(lines) && lines.length
    ? `${title} (${lines.length}, свежие сверху):\n${lines.map(String).join('\n')}` : null)
  const text = [part('Диагностика', logs.diagnostic), part('Свайпы «назад»', logs.swipe), part('Пуши', logs.push)].filter(Boolean).join('\n\n')
  return text || null
}
