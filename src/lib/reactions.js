// Реакции в Ленте (v3.2.0, виш BACKLOG). Чистая логика без Dexie/сети.
//
// Виды реакций НЕЗАВИСИМЫ (можно поставить несколько разных под одной
// тренировкой). Эмодзи держим только на клиенте, на сервере/в очереди — слаги
// (muscle/fire/clap/wow), см. supabase/reactions.sql.

// Порядок = порядок кнопок в карточке ленты.
export const REACTION_KINDS = [
  { kind: 'muscle', emoji: '💪' },
  { kind: 'fire', emoji: '🔥' },
  { kind: 'clap', emoji: '👏' },
  { kind: 'wow', emoji: '😮' },
]

const KIND_SET = new Set(REACTION_KINDS.map((k) => k.kind))
export const isReactionKind = (k) => KIND_SET.has(k)

// Сводка реакций тренировки для UI.
//   list — плоский массив [{ user_id, name, kind }] (сервер + оптимистичная
//          очередь; см. applyReactionQueue);
//   myId — id текущего зрителя (для подсветки «моя реакция»).
// Возвращает:
//   kinds — все четыре вида в фиксированном порядке: { kind, emoji, count, mine };
//   names — УНИКАЛЬНЫЕ имена реагировавших (по любому виду), в порядке появления;
//   total — суммарное число реакций.
export function summarizeReactions(list, myId) {
  const items = Array.isArray(list) ? list : []
  const counts = new Map()
  const mine = new Set()
  const names = []
  const seenUsers = new Set()
  for (const r of items) {
    if (!isReactionKind(r?.kind)) continue
    counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1)
    if (r.user_id != null && r.user_id === myId) mine.add(r.kind)
    if (r.user_id != null && !seenUsers.has(r.user_id)) {
      seenUsers.add(r.user_id)
      names.push(r.name ?? '—')
    }
  }
  const kinds = REACTION_KINDS.map((k) => ({
    kind: k.kind,
    emoji: k.emoji,
    count: counts.get(k.kind) ?? 0,
    mine: mine.has(k.kind),
  }))
  const total = kinds.reduce((n, k) => n + k.count, 0)
  return { kinds, names, total }
}

// Компактная строка имён под кнопками: «Петя, Вася +2». cap — сколько имён
// показать до сворачивания в «+N». Пусто → ''.
export function reactorLine(names, cap = 3) {
  const list = Array.isArray(names) ? names : []
  if (list.length === 0) return ''
  if (list.length <= cap) return list.join(', ')
  return list.slice(0, cap).join(', ') + ' +' + (list.length - cap)
}

// Наложить локальную очередь реакций (reaction_outbox) на элементы ленты, чтобы
// ещё не отправленные тапы отражались сразу и в офлайне (оптимистичный UI).
//   items — элементы ленты с полем reactions: [{user_id,name,kind}];
//   ops   — очередь [{ workoutId, kind, op:'add'|'remove' }] (все — МОИ);
//   me    — { id, name } текущего пользователя.
// Возвращает НОВЫЙ массив items (исходный не мутирует).
export function applyReactionQueue(items, ops, me) {
  if (!Array.isArray(items) || !Array.isArray(ops) || ops.length === 0) return items
  const myId = me?.id
  const myName = me?.name ?? '—'
  const byWorkout = new Map()
  for (const op of ops) {
    if (!op?.workoutId || !isReactionKind(op?.kind)) continue
    if (!byWorkout.has(op.workoutId)) byWorkout.set(op.workoutId, [])
    byWorkout.get(op.workoutId).push(op)
  }
  return items.map((item) => {
    const wops = byWorkout.get(item.id)
    if (!wops) return item
    let list = (item.reactions ?? []).slice()
    for (const op of wops) {
      if (op.op === 'add') {
        if (!list.some((r) => r.user_id === myId && r.kind === op.kind)) {
          list = [...list, { user_id: myId, name: myName, kind: op.kind }]
        }
      } else if (op.op === 'remove') {
        list = list.filter((r) => !(r.user_id === myId && r.kind === op.kind))
      }
    }
    return { ...item, reactions: list }
  })
}
