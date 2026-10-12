import { normalizeName, levenshtein } from './similar.js'

// Deliberately curated: equipment labels can describe several variants.
// Targets are resolved against the visible local catalog, never invented or created.
const LABELS = [
  [['lat pulldown', 'lat pull down'], ['Тяга верхнего блока']],
  [['leg extension'], ['Разгибание ног в тренажере']],
  [['leg curl', 'seated leg curl', 'lying leg curl'], ['Сгибание ног в тренажере']],
  [['leg press'], ['Жим ногами']],
  [['hip abductor', 'hip abduction'], ['Разведение ног в тренажере (Hip Abductor)']],
  [['hip adductor', 'hip adduction'], ['Сведение ног в тренажёре (Hip Adductor)']],
  [['seated row', 'low row'], ['Горизонтальная тяга блока']],
  [['chest press', 'incline chest press'], ['Жим в тренажере Хаммер']],
  [['pec deck', 'chest fly'], ['Сведения в тренажере Бабочка']],
  [['reverse fly', 'rear delt'], ['Обратное сведение в тренажере', 'Махи гантелями в наклоне']],
  [['shoulder press'], ['Жим плечами в тренажере', 'Жим в тренажере на плечи']],
  [['biceps curl', 'arm curl'], ['Сгибание рук на изолированном тренажере', 'Сгибание рук на нижнем блоке']],
  [['triceps extension', 'triceps press'], ['Разгибание рук на блоке', 'Разгибание рук на блоке с канатом']],
  [['abdominal crunch', 'ab crunch'], ['Скручивания на тренажере', 'Сгибание туловища сидя']],
  [['back extension'], ['Гиперэкстензия', 'Гиперэкстензия (акцент на ягодицы)']],
  [['calf raise'], ['Подъем на носки сидя', 'Подъем на носки стоя']],
  [['assisted pull up', 'assisted chin up'], ['Подтягивания на тренажере']],
  [['glute drive', 'hip thrust'], ['Ягодичный мостик в тренажере', 'Ягодичный мостик со штангой']],
  [['rowing machine', 'rower'], ['Гребной тренажер']],
  [['treadmill'], ['Бег', 'Ходьба (в т.ч. в гору)']],
  [['elliptical', 'cross trainer'], ['Эллипс (Орбитрек)']],
]

function phraseMatch(text, phrase) {
  if (` ${text} `.includes(` ${phrase} `)) return true
  const words = phrase.split(' '), input = text.split(' ')
  if (words.length < 2) return false
  return input.some((_, i) => {
    const slice = input.slice(i, i + words.length)
    if (slice.length !== words.length) return false
    // One OCR typo in the whole phrase, not fuzzy matching each short word.
    return words.reduce((n, w, j) => n + levenshtein(w, slice[j]), 0) <= 1
  })
}

export function matchScannedText(text, exercises) {
  const norm = normalizeName(String(text).slice(0, 500))
  if (norm.length < 5) return []
  const targets = new Set()
  for (const [aliases, names] of LABELS) {
    if (aliases.some(a => phraseMatch(norm, a))) names.forEach(n => targets.add(normalizeName(n)))
  }
  const unresolved = new Set(['Приведение руки к груди', 'Шраги со штангой лежа', 'Сведение гантелей за голову лежа на скамье', 'Разведения сидя на опоре', 'Ягодичный мост со сведенными стопами'].map(normalizeName))
  return exercises.filter(e => !e.is_hidden && !unresolved.has(normalizeName(e.name)) && (
    targets.has(normalizeName(e.name)) ||
    (normalizeName(e.name).length >= 6 && phraseMatch(norm, normalizeName(e.name)))
  )).map(exercise => ({ exercise }))
}
