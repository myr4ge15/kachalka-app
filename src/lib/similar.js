// ============================================================================
// Нечёткое сравнение названий упражнений — анти-дубли (ТЗ 3.2 / 4.4).
//
// Цель: при вводе своего упражнения показать ПОХОЖИЕ из справочника, чтобы
// пользователь не плодил дубли вроде «Жим лёжа» / «жим лежа» / «жим лежа штанга»
// / «жим лёжа штангой» / опечаток «жим лжа».
//
// Наивный includes() этого не ловит: он чувствителен к ё/е, лишним пробелам,
// порядку слов и опечаткам. Здесь — нормализация + комбинированная оценка
// (пересечение слов + расстояние Левенштейна по «склеенной» строке).
// ============================================================================

// Нормализация: нижний регистр, ё→е, убрать пунктуацию, схлопнуть пробелы.
// Используется и для показа похожих, и для определения точного дубля.
export function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ') // пунктуация/спецсимволы → пробел
    .trim()
    .replace(/\s+/g, ' ')
}

// Значимые слова названия (откидываем «шум»: предлоги, общие слова).
const STOP = new Set([
  'на', 'в', 'с', 'со', 'и', 'для', 'из', 'по', 'над', 'под',
  'штанга', 'штангой', 'штанги', 'гантели', 'гантель', 'гантелями',
  'тренажер', 'тренажере', 'блок', 'блоке', 'хват', 'хватом',
])

function tokens(norm) {
  return norm.split(' ').filter((w) => w && !STOP.has(w))
}

// Расстояние Левенштейна (итеративно, две строки) — для опечаток.
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let cur = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

// Оценка похожести двух названий: 0..1 (1 — фактически одно и то же).
// Комбинируем две метрики и берём максимум:
//   1) пересечение значимых слов (Жaccard) — ловит разный порядок и лишние слова;
//   2) сходство по символам через Левенштейн — ловит опечатки.
export function similarityScore(aRaw, bRaw) {
  const a = normalizeName(aRaw)
  const b = normalizeName(bRaw)
  if (!a || !b) return 0
  if (a === b) return 1

  // --- словарная метрика (Jaccard по значимым токенам) ---
  const ta = tokens(a)
  const tb = tokens(b)
  let wordScore = 0
  if (ta.length && tb.length) {
    const setB = new Set(tb)
    const inter = ta.filter((w) => setB.has(w)).length
    const union = new Set([...ta, ...tb]).size
    wordScore = inter / union
  }

  // --- символьная метрика (нормированный Левенштейн) ---
  const dist = levenshtein(a, b)
  const charScore = 1 - dist / Math.max(a.length, b.length)

  // Подстрока («жим лежа» ⊂ «жим лежа узким хватом») — сильный сигнал дубля.
  const substr = a.includes(b) || b.includes(a) ? 0.6 : 0

  return Math.max(wordScore, charScore, substr)
}

// Найти похожие упражнения из справочника, отсортированные по убыванию похожести.
// threshold ~0.45 — компромисс: ловим дубли/опечатки, не засыпаем мусором.
export function findSimilar(query, exercises, { threshold = 0.45, limit = 5 } = {}) {
  const q = normalizeName(query)
  if (q.length < 2) return []
  return exercises
    .map((e) => ({ ex: e, score: similarityScore(query, e.name) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.ex)
}

// Есть ли в справочнике практически точный дубль (для предупреждения/слияния).
export function findExactDuplicate(name, exercises) {
  const key = normalizeName(name)
  if (!key) return null
  return exercises.find((e) => normalizeName(e.name) === key) ?? null
}
