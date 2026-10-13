import { normalizeName, levenshtein } from './similar.js'

// Deliberately curated: equipment labels can describe several variants.
// Targets are resolved against the visible local catalog, never invented or created.
const LABELS = [
  [['lat pulldown', 'lat pull down'], ['Тяга верхнего блока']],
  [['leg extension'], ['Разгибание ног в тренажере']],
  [['leg curl', 'seated leg curl', 'lying leg curl'], ['Сгибание ног в тренажере']],
  [['leg press'], ['Жим ногами']],
  [['hip abductor', 'hip abduction', 'abductor'], ['Разведение ног в тренажере (Hip Abductor)']],
  [['hip adductor', 'hip adduction', 'adductor'], ['Сведение ног в тренажёре (Hip Adductor)']],
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

function phraseMatch(text, phrase, fuzzy = false) {
  if (` ${text} `.includes(` ${phrase} `)) return true
  if (!fuzzy) return false
  const words = phrase.split(' '), input = text.split(' ')
  if (words.length < 2) return false
  return input.some((_, i) => {
    const slice = input.slice(i, i + words.length)
    if (slice.length !== words.length) return false
    // One OCR typo in the whole phrase, not fuzzy matching each short word.
    const directional = /^(abductor|adductor|abduction|adduction)$/
    if (words.some((w, j) => (directional.test(w) || directional.test(slice[j])) && w !== slice[j])) return false
    return words.reduce((n, w, j) => n + levenshtein(w, slice[j]), 0) <= 1
  })
}

// Best match first: the scanner offers matches[0] as the main candidate.
export function matchScannedText(text, exercises) {
  const norm = normalizeName(String(text).slice(0, 500))
  if (norm.length < 5) return []
  const unresolved = new Set(['Приведение руки к груди', 'Шраги со штангой лежа', 'Сведение гантелей за голову лежа на скамье', 'Разведения сидя на опоре', 'Ягодичный мост со сведенными стопами'].map(normalizeName))
  const visible = exercises.filter(e => !e.is_hidden && !unresolved.has(normalizeName(e.name)))
  const find = fuzzy => {
    const targets = new Map()
    for (const [aliases, names] of LABELS) {
      const label = aliases.find(a => phraseMatch(norm, a, fuzzy))
      if (label) names.forEach((n, order) => {
        const key = normalizeName(n)
        if (!targets.has(key)) targets.set(key, { label: label.toUpperCase(), order, size: label.length })
      })
    }
    return visible.flatMap(exercise => {
      const name = normalizeName(exercise.name)
      const target = targets.get(name)
      // The exercise's own name on the plate is the strongest evidence; then the
      // curated label targets in their listed order (first = the usual machine).
      if (name.length >= 6 && phraseMatch(norm, name, fuzzy)) return [{ exercise, label: target?.label || exercise.name, rank: [0, 0, -name.length] }]
      return target ? [{ exercise, label: target.label, rank: [1, target.order, -target.size] }] : []
    }).sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2])
      .map(({ exercise, label }) => ({ exercise, label }))
  }
  const exact = find(false)
  return exact.length ? exact : find(true)
}
