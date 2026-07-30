// ============================================================================
// Умный поиск по справочнику упражнений (BACKLOG «Пикер упражнений — умный
// поиск»). Голый `name.includes(query)` промахивался ровно там, где больно:
// «жим лежа» не находил «Жим лёжа» (и провоцировал дубль), «лежа жим» не
// находил ничего, «верх блок» не находил «Тяга верхнего блока», «жим лжа» —
// пусто, а «плеч» не находил ни одного упражнения на плечи.
//
// Почему это НЕ `findSimilar` из `similar.js`: тот настроен под анти-дубли
// (порог 0.45, требование ≥2 общих токенов, содержательная подстрока ≥5
// символов) и намеренно молчит на коротком запросе — «верх» против «Тяга
// верхнего блока» даёт там ~0. Подкрутка тех порогов сломала бы защиту от
// дублей, поэтому у поиска своя шкала. Общими остаются нормализация и
// Левенштейн.
// ============================================================================

import { normalizeName, levenshtein } from './similar.js'
import { labelOf } from './muscles.js'

// Ниже этой длины запроса не включаем опечатки и поиск по мышцам: на «жи»
// оба правила вываливают половину справочника.
const MIN_LEN_LOOSE = 3

// Тиры совпадения по названию — чем меньше, тем выше в списке.
const TIER_EXACT = 0   // «жим лежа» → «Жим лёжа»
const TIER_PREFIX = 1  // «жим ле» → «Жим лёжа»
const TIER_TOKENS = 2  // «верх блок» → «Тяга верхнего блока»
const TIER_SUBSTR = 3  // старое поведение как фолбэк
const TIER_TYPO = 4    // «жим лжа» → «Жим лёжа»
const NO_MATCH = Infinity

function words(norm) {
  return norm ? norm.split(' ').filter(Boolean) : []
}

// Допуск опечатки растёт с длиной слова. От трёх букв уже нужна одна правка:
// самый частый промах — проглоченная гласная («лжа» вместо «лёжа»). Ниже трёх
// букв не прощаем ничего, иначе токен матчит пол-справочника.
function typoTolerance(len) {
  if (len >= 7) return 2
  if (len >= 3) return 1
  return 0
}

// Каждый токен запроса должен «занять» СВОЙ токен названия, поэтому порядок
// слов не важен, а один токен названия не закрывает два токена запроса
// («жим жим» не матчит «Жим лёжа»).
function everyTokenMatches(qTokens, nameTokens, match) {
  const used = new Array(nameTokens.length).fill(false)
  return qTokens.every((qt) => {
    const i = nameTokens.findIndex((nt, idx) => !used[idx] && match(qt, nt))
    if (i < 0) return false
    used[i] = true
    return true
  })
}

function nameTier(q, qTokens, name) {
  const n = normalizeName(name)
  if (!n) return NO_MATCH
  if (n === q) return TIER_EXACT
  if (n.startsWith(q)) return TIER_PREFIX

  const nTokens = words(n)
  if (everyTokenMatches(qTokens, nTokens, (qt, nt) => nt.startsWith(qt))) return TIER_TOKENS
  if (n.includes(q)) return TIER_SUBSTR

  if (q.length >= MIN_LEN_LOOSE) {
    const byTypo = (qt, nt) => levenshtein(qt, nt) <= typoTolerance(qt.length)
    if (everyTokenMatches(qTokens, nTokens, byTypo)) return TIER_TYPO
  }
  return NO_MATCH
}

// Мышцы упражнения одной плоской россыпью токенов: крупная группа + подписи
// основной и вторичных подмышц (слаги латиницей, поэтому через labelOf).
function muscleTokens(ex) {
  const parts = [ex.muscle_group, labelOf(ex.submuscle), ...(ex.secondary ?? []).map(labelOf)]
  return parts.flatMap((p) => words(normalizeName(p)))
}

function matchesMuscle(qTokens, ex) {
  const hay = muscleTokens(ex)
  return qTokens.every((qt) => hay.some((h) => h.startsWith(qt)))
}

// Результат разделён на два списка: совпадения по названию и (ниже, отдельным
// блоком в UI) совпадения только по мышце — иначе непонятно, почему «Жим
// гантелей сидя» показался на запрос «плеч».
export function searchExercises(query, exercises) {
  const q = normalizeName(query)
  if (!q) return { byName: exercises, byMuscle: [] }
  const qTokens = words(q)

  const named = []
  const byMuscle = []
  exercises.forEach((ex, index) => {
    const tier = nameTier(q, qTokens, ex.name)
    if (tier !== NO_MATCH) {
      named.push({ ex, tier, index, len: normalizeName(ex.name).length })
    } else if (q.length >= MIN_LEN_LOOSE && matchesMuscle(qTokens, ex)) {
      byMuscle.push(ex)
    }
  })

  // Внутри тира короткое название выше: «Жим лёжа» перед «Жим лёжа узким хватом».
  named.sort((a, b) => a.tier - b.tier || a.len - b.len || a.index - b.index)
  return { byName: named.map((r) => r.ex), byMuscle }
}
