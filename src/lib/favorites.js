// ============================================================================
// Избранные упражнения (⭐ в пикере, v6.5.0) — ЧИСТАЯ логика.
//
// Значение — массив id упражнений, свежедобавленные СВЕРХУ (в этом порядке
// пикер и показывает блок «Избранные»). Хранится синкаемым родом `fav` в
// user_meta (LWW, как accent/prog): связный список, частичное слияние двух
// устройств дало бы «воскрешение» снятых звезд.
// ============================================================================

// Верхняя граница: из ~90 упражнений человек регулярно делает 10–15. Список
// длиннее перестает быть «быстрым доступом» и лишь раздувает user_meta.
export const FAV_LIMIT = 30

// Привести что угодно из meta к чистому списку: строки, без дублей и пустых,
// не длиннее лимита. Мусор (не массив) → пустой список.
export function normalizeFavs(value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const v of value) {
    if (v == null || v === '') continue
    const id = String(v)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= FAV_LIMIT) break
  }
  return out
}

// Переключить звезду: есть — убрать, нет — добавить в начало (при переполнении
// отваливается самое старое избранное).
export function toggleFav(value, id) {
  const list = normalizeFavs(value)
  const key = String(id)
  if (list.includes(key)) return list.filter((x) => x !== key)
  return normalizeFavs([key, ...list])
}
