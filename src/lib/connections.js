// Связи «избранного круга» (v3.14.0), АДМИН-управляемые. Чистая логика без сети —
// покрыта connections.test.js.
//
// Связь — неориентированная пара участников {low_id, high_id} (см.
// supabase/connections.sql). На клиенте нужна только админке: построить набор
// «с кем связан вот этот участник», чтобы отрисовать галочки в матрице доступа.

// Второй участник пары относительно userId; null, если пара его не содержит.
export function otherInPair(pair, userId) {
  if (!pair) return null
  if (pair.low_id === userId) return pair.high_id
  if (pair.high_id === userId) return pair.low_id
  return null
}

// Множество id участников, с кем есть связь у userId. Учитываем только принятые
// (status === 'accepted' либо статус не указан — совместимость). Возвращает Set.
export function connectedIdsFor(pairs, userId) {
  const set = new Set()
  for (const p of pairs ?? []) {
    if (p?.status && p.status !== 'accepted') continue
    const other = otherInPair(p, userId)
    if (other != null) set.add(other)
  }
  return set
}
