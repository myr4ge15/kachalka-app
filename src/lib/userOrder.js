// Порядок учёток на экране входа (v1.9.0). Источник правды — users.sort_order
// (задаётся админом перетаскиванием). Учётки без порядка (NULL — в т.ч. вновь
// созданные) уходят В КОНЕЦ, без алфавита; тай-брейк по id (стабильно, не по
// имени — таково требование). Чистая функция: используется и в repo.getUsers,
// и юнит-тестом.
export function compareUserOrder(a, b) {
  const ao = a == null ? null : a.sort_order
  const bo = b == null ? null : b.sort_order
  const an = ao == null || Number.isNaN(Number(ao))
  const bn = bo == null || Number.isNaN(Number(bo))
  if (an && bn) return idCmp(a, b)        // оба без порядка → стабильно по id
  if (an) return 1                         // a в конец
  if (bn) return -1                        // b в конец
  if (Number(ao) !== Number(bo)) return Number(ao) - Number(bo)
  return idCmp(a, b)
}

function idCmp(a, b) {
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
}

// Отсортировать копию массива учёток по порядку входа.
export function sortUsersByOrder(list) {
  return [...(list ?? [])].sort(compareUserOrder)
}
