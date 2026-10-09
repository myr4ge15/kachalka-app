// Переставить элемент списка по id: встать перед beforeId (null — в конец).
// Тот же массив, если порядок не изменился (React не перерисует зря).
export function reorderById(list, id, beforeId, keyOf) {
  const item = list.find(x => keyOf(x) === id)
  if (!item || id === beforeId) return list
  const rest = list.filter(x => x !== item)
  const to = beforeId === null ? rest.length : rest.findIndex(x => keyOf(x) === beforeId)
  if (to < 0) return list
  rest.splice(to, 0, item)
  return rest.every((x, i) => x === list[i]) ? list : rest
}
