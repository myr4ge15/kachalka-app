// Связи между участниками (v3.14.0, «избранный круг для приватных»). Чистая
// логика без Dexie/сети — покрыта connections.test.js.
//
// Модель (см. supabase/connections.sql): одна ВЗАИМНАЯ связь на пару с
// подтверждением. Строка кэша (из my_connections):
//   { other_id, other_name, status: 'pending'|'accepted', requested_by }
// Направление выводим на клиенте относительно СВОЕГО id:
//   accepted — доступ открыт в обе стороны;
//   outgoing — я отправил запрос, ждём подтверждения второй стороны;
//   incoming — вторая сторона запросила меня, жду моего «принять».

// Направление связи относительно зрителя myId. Неизвестная строка → null.
export function connectionDirection(row, myId) {
  if (!row || !row.status) return null
  if (row.status === 'accepted') return 'accepted'
  return row.requested_by === myId ? 'outgoing' : 'incoming'
}

// Разложить строки связей по корзинам для UI. Каждый элемент дополнен полем
// `direction`. Не-распознанные (нет status) отбрасываем.
export function deriveConnections(rows, myId) {
  const accepted = []
  const incoming = []
  const outgoing = []
  for (const r of rows ?? []) {
    const direction = connectionDirection(r, myId)
    if (!direction) continue
    const item = { ...r, direction }
    if (direction === 'accepted') accepted.push(item)
    else if (direction === 'incoming') incoming.push(item)
    else outgoing.push(item)
  }
  return { accepted, incoming, outgoing }
}

// id второй стороны по всем ПРИНЯТЫМ связям (для фильтра «кого показывать
// приватному в Ленте» / бейджей). Порядок — как во входе.
export function acceptedOtherIds(rows) {
  return (rows ?? []).filter((r) => r?.status === 'accepted').map((r) => r.other_id)
}

// Есть ли уже связь (любого статуса) с этим участником — чтобы не предлагать его
// повторно в пикере «добавить».
export function hasConnection(rows, otherId) {
  return (rows ?? []).some((r) => r?.other_id === otherId)
}

// Схлопывание очереди операций по ОДНОМУ участнику (connection_outbox). На входе —
// уже стоящие операции этой пары [{op}] и новая операция ('request'|'accept'|
// 'remove'); на выходе — итоговый набор (0–1 операция). Правила:
//   • remove затирает всё (отклонить/отменить/разорвать) → одна 'remove'; если в
//     очереди был только неотправленный 'request', серверного ряда, скорее всего,
//     ещё нет, но delete идемпотентен — безопасно оставить 'remove';
//   • request/accept дедуплицируются (повтор того же намерения ничего не меняет),
//     а поверх ранее стоявшего 'remove' — заменяют его.
export function mergeConnectionOp(existingOps, newOp) {
  const kinds = new Set((existingOps ?? []).map((o) => o.op))
  if (newOp === 'remove') return [{ op: 'remove' }]
  if (newOp === 'request') {
    return kinds.has('request') || kinds.has('accept') ? (existingOps ?? []) : [{ op: 'request' }]
  }
  if (newOp === 'accept') {
    return kinds.has('accept') ? (existingOps ?? []) : [{ op: 'accept' }]
  }
  return existingOps ?? []
}
