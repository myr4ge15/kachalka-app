// Русская плюрализация по числу — единый источник. Раньше жила двумя копиями:
// `plural` в insights.js и `dayWord` в homeSummary.js (РЕВЬЮ-КОДА-2026-07-13).
//
//   plural(n, one, few, many):
//     one  — форма для 1, 21, 31…   (кроме 11)
//     few  — форма для 2–4, 22–24…  (кроме 12–14)
//     many — форма для 0, 5–20, 11–14…
// Пример: plural(n, 'день', 'дня', 'дней').
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

// «N форма» — число + просклонённое слово.
export const pluralize = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`
