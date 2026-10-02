// Классификация ошибок отправки очереди: временная (сеть, таймаут, сервер лежит,
// токен протух) или постоянная (сервер ПРИНЯЛ запрос и отверг данные).
//
// Зачем. Операция, провалившая MAX_ATTEMPTS попыток, уходит в dead-letter. Раньше
// попыткой считалась любая ошибка — и пять таймаутов подряд в подвале зала или за
// Wi-Fi-порталом (navigator.onLine там true) «отравляли» совершенно здоровую
// операцию. Для шаблонов и упражнений это заканчивалось молчаливой потерей правки:
// pull видит «грязную без живой операции» и берет серверную версию
// (РЕВЬЮ-КОДА-2026-10-02, п. 4). Счетчик попыток должен расти только там, где
// повтор заведомо бесполезен.
//
// Чистый модуль: без Dexie, сети и React.

// Коды Postgres, при которых повтор имеет смысл: 08 — соединение, 53 — нехватка
// ресурсов, 57 — вмешательство оператора (в т.ч. 57014 statement timeout),
// 40001/40P01 — сериализация и взаимоблокировка.
const TRANSIENT_PG = /^(08|53|57)/
const TRANSIENT_PG_EXACT = new Set(['40001', '40P01'])
// PostgREST: PGRST0xx — нет связи с базой / схема не загружена; PGRST3xx — JWT
// (истек, не разобран). Токен перевыпустится — операция ни при чем.
const TRANSIENT_PGRST = /^PGRST(0|3)/
// Тексты сетевых сбоев fetch в разных браузерах.
const NETWORK_TEXT = /failed to fetch|networkerror|network request failed|load failed|fetch failed|превышено время ожидания/i

export function isTransientSyncError(err) {
  if (err == null) return false
  const name = String(err.name ?? '')
  if (name === 'AbortError' || name === 'TimeoutError') return true
  const message = String(err.message ?? err)
  if (NETWORK_TEXT.test(message)) return true
  const code = err.code == null ? '' : String(err.code)
  if (code) {
    return TRANSIENT_PG.test(code) || TRANSIENT_PG_EXACT.has(code) || TRANSIENT_PGRST.test(code)
  }
  // Кода нет. supabase-js отдает сбой сети и ответ шлюза (5xx, HTML вместо JSON)
  // ПРОСТЫМ объектом без кода — это временное. А вот настоящий Error без кода —
  // исключение в нашем собственном обработчике (битый документ): его повтор не
  // вылечит, пусть идет обычным путем в dead-letter и не вешает очередь.
  return !(err instanceof Error)
}
