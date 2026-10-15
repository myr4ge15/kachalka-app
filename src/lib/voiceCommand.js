// ============================================================================
// Разбор голосовой фразы (v8.7.0). Чистая логика: без React, браузерного API и
// справочника. Одна фраза → { action, query, set }:
//   - query — слова ДО первого числа, без командных слов («добавь», «запиши»):
//     название упражнения для пикера («жим лежа 60 на 12» → «жим лежа»);
//   - set — то, что сказано про подход: { weight?, reps?, setNo?, newSet? } или null.
//     Поля, которых не прозвучало, отсутствуют: экран дополнит их из строки подхода.
//   - action — 'add_set', если есть подход и нет названия, иначе 'add_exercise'
//     (set.error — чисел больше, чем вес и повторы: показать, а не угадывать).
// Формат команды задуман на вырост (update_set, finish_exercise…), пока
// используются только две. Голос никогда не пишет сам: решение — у человека.
// ============================================================================
import { normMetric } from './metric.js'
import { REPS_MAX, WEIGHT_MAX, weightMin } from './setLimits.js'

const UNITS = {
  ноль: 0, один: 1, одна: 1, одну: 1, одного: 1, два: 2, две: 2, двух: 2, три: 3, трех: 3,
  четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11,
  двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
}
const TENS = {
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70,
  восемьдесят: 80, девяносто: 90,
}
const HUNDREDS = {
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600,
  семьсот: 700, восемьсот: 800, девятьсот: 900,
}
// Разговорные круглые числа зала.
const SLANG = { полтинник: 50, полтос: 50, сотка: 100, сотку: 100, соточка: 100, полтора: 1.5 }
const ORDINALS = [
  [/^перв/, 1], [/^втор/, 2], [/^трет/, 3], [/^четверт/, 4], [/^пят/, 5],
  [/^шест/, 6], [/^седьм/, 7], [/^восьм/, 8], [/^девят/, 9], [/^десят/, 10],
]
const KG = new Set(['кг', 'кило', 'килограмм', 'килограмма', 'килограммов', 'килограммах'])
const REPS = new Set(['раз', 'раза', 'повтор', 'повтора', 'повторов', 'повторение', 'повторения',
  'повторений', 'повт'])
const COMMAND = new Set(['добавь', 'добавить', 'добавим', 'запиши', 'записать', 'запишем', 'давай',
  'упражнение', 'сделал', 'сделала'])
const SET_WORD = /^подход(?:а|е|ом)?$/
const MORE = new Set(['еще', 'новый'])

function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)\s*[,.]\s*(\d)/g, '$1.$2') // «62,5» и «62.5» — одно число
    .replace(/(\d)\s*[x×х*]\s*(\d)/g, '$1 на $2') // «60x12», «60×12»
    .replace(/(\d)(?=[а-я])/g, '$1 ') // «60кг», «2-й» → «60 кг», «2 й»
    .replace(/−/g, ' минус ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ') // точка конца фразы — не часть числа
    .replace(/[^a-zа-я0-9.]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && t !== '.')
}

function isNumberWord(t) {
  return /^\d+(?:\.\d+)?$/.test(t) || t in UNITS || t in TENS || t in HUNDREDS || t in SLANG
}

// Число, начиная с tokens[i]: цифры или слова («сто двадцать пять», «шестьдесят
// два с половиной»). Возвращает { value, next } или null.
function readNumber(list, i) {
  const t = list[i]
  let value
  let j = i
  if (/^\d+(?:\.\d+)?$/.test(t)) {
    value = Number(t)
    j = i + 1
  } else if (t in SLANG) {
    value = SLANG[t]
    j = i + 1
  } else {
    let sum = 0
    let seen = false
    let tens = false
    if (list[j] in HUNDREDS) { sum += HUNDREDS[list[j]]; j++; seen = true }
    if (list[j] in TENS) { sum += TENS[list[j]]; j++; seen = true; tens = true }
    // «двадцать двенадцать» — два числа (20 на 12), а «сто двенадцать» — одно.
    if (list[j] in UNITS && !(tens && UNITS[list[j]] >= 10) && !(seen && UNITS[list[j]] === 0)) {
      sum += UNITS[list[j]]; j++; seen = true
    }
    if (!seen) return null
    value = sum
  }
  // «…с половиной» / «…половиной»
  if (list[j] === 'с' && list[j + 1] === 'половиной') { value += 0.5; j += 2 }
  else if (list[j] === 'половиной') { value += 0.5; j += 1 }
  return { value, next: j }
}

function ordinalOf(t) {
  const m = ORDINALS.find(([re]) => re.test(t ?? ''))
  return m ? m[1] : null
}

// Разбор хвоста фразы про подход. null — чисел нет вовсе; { error } — чисел
// больше, чем умеем понять (вес и повторы — максимум два).
function parseSetTokens(list) {
  const items = []
  let setNo
  let newSet = false
  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    if (MORE.has(t)) { newSet = true; continue }
    // «второй подход», «2 й подход», «подход 2», «подход номер два»
    if (SET_WORD.test(t)) {
      const prevOrd = ordinalOf(list[i - 1])
      const prevNum = /^\d+$/.test(list[i - 1] ?? '') ? Number(list[i - 1]) : null
      const prevNum2 = list[i - 1] === 'й' && /^\d+$/.test(list[i - 2] ?? '') ? Number(list[i - 2]) : null
      if (setNo == null && (prevOrd ?? prevNum ?? prevNum2) != null) {
        setNo = prevOrd ?? prevNum ?? prevNum2
        // число перед «подход» уже ушло в items — забираем его обратно
        if (prevNum != null || prevNum2 != null) items.pop()
        continue
      }
      let k = i + 1
      if (list[k] === 'номер') k++
      const n = list[k] != null && isNumberWord(list[k]) ? readNumber(list, k) : null
      if (setNo == null && n && Number.isInteger(n.value)) { setNo = n.value; i = n.next - 1; continue }
      if (list[i - 1] === 'новый') newSet = true
      continue
    }
    const neg = t === 'минус'
    const at = neg ? i + 1 : i
    if (list[at] == null || !isNumberWord(list[at])) continue
    const n = readNumber(list, at)
    if (!n) continue
    const conn = items.length ? list.slice(items[items.length - 1].end, at).find((w) => w === 'на' || w === 'по') : null
    let unit = null
    let next = n.next
    if (KG.has(list[next])) { unit = 'kg'; next++ } else if (REPS.has(list[next])) { unit = 'reps'; next++ }
    items.push({ value: neg ? -n.value : n.value, unit, conn: conn ?? null, end: next })
    i = next - 1
  }
  if (!items.length && setNo == null && !newSet) return null
  if (items.length > 2) return { error: 'too-many' }
  const set = {}
  for (const it of items) {
    if (it.unit === 'kg' && set.weight == null) set.weight = it.value
    if (it.unit === 'reps' && set.reps == null) set.reps = it.value
  }
  const bare = items.filter((it) => !it.unit)
  if (bare.length === 2) {
    // «12 по 60» — повторы по весу; «60 на 12», «60 12» — вес на повторы.
    const [a, b] = bare[1].conn === 'по' ? [bare[1], bare[0]] : [bare[0], bare[1]]
    if (set.weight == null) set.weight = a.value
    if (set.reps == null) set.reps = b.value
  } else if (bare.length === 1) {
    // Одно голое число дополняет недостающее; если не хватает обоих — это повторы
    // («12» = «12 раз»): вес чаще всего уже стоит в строке. Вес называют с «кг».
    if (set.reps == null) set.reps = bare[0].value
    else if (set.weight == null) set.weight = bare[0].value
  }
  if (setNo != null) set.setNo = setNo
  if (newSet) set.newSet = true
  return set
}

export function parseVoiceCommand(text) {
  const list = tokens(text).filter((t) => !COMMAND.has(t))
  // Название — до первого числа или слова «подход»; дальше — про подход.
  let cut = list.findIndex((t, i) => isNumberWord(t) || SET_WORD.test(t)
    || (t === 'минус' && isNumberWord(list[i + 1] ?? '')))
  if (cut === -1) cut = list.length
  else if (cut > 0 && SET_WORD.test(list[cut]) && ordinalOf(list[cut - 1])) cut -= 1
  const head = list.slice(0, cut)
  // «еще 60 на 12», «новый подход» — подход новой строкой; в названии эти слова не нужны.
  const more = head.some((t) => MORE.has(t))
  const query = head.filter((t) => !MORE.has(t)).join(' ')
  let set = parseSetTokens(list.slice(cut))
  if (more && !set?.error) set = { ...(set ?? {}), newSet: true }
  const action = set && !query ? 'add_set' : 'add_exercise'
  return { action, query, set }
}

// Какую строку меняет голос: «второй подход …» → её; «еще …» → новую; иначе —
// строку под курсором (следующую после последней записанной голосом), за концом
// списка — новую. Возвращает индекс 0..count (count = новая строка) или -1, если
// названного подхода нет.
export function voiceSetTarget(set, count, cursor = 0) {
  if (set?.newSet) return count
  if (set?.setNo != null) return set.setNo >= 1 && set.setNo <= count + 1 ? set.setNo - 1 : -1
  return Math.min(Math.max(0, cursor), count)
}

// Подход после голосовой правки: недостающее берем из строки (или из последней,
// если строка новая). null — чисел не хватает или они вне границ метрики; молча не
// подрезаем, как делает степпер: голос, понятый неверно, должен быть виден.
export function mergeVoiceSet(set, base, metric) {
  const m = normMetric(metric)
  if (!set || set.error || (m !== 'weight' && m !== 'reps')) return null
  const weight = Number(set.weight ?? base?.weight ?? 0)
  const reps = Number(set.reps ?? base?.reps)
  if (!Number.isInteger(reps) || reps < 1 || reps > REPS_MAX) return null
  if (!Number.isFinite(weight) || weight < weightMin(m) || weight > WEIGHT_MAX) return null
  return { weight: Math.round(weight * 100) / 100 || 0, reps }
}

// Лучший из вариантов распознавателя для подхода: первый, где понятны числа.
// Ни в одном нет — первый как есть (экран покажет, что услышал и чего не хватает).
export function bestSetPhrase(phrases) {
  for (const phrase of phrases ?? []) {
    const { set } = parseVoiceCommand(phrase)
    if (set && !set.error && (set.weight != null || set.reps != null)) return { phrase, set }
  }
  const phrase = phrases?.[0] ?? ''
  return { phrase, set: phrase ? parseVoiceCommand(phrase).set : null }
}
