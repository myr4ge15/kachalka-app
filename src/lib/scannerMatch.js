import { normalizeName, levenshtein } from './similar.js'

// Deliberately curated: equipment labels can describe several variants.
// Targets are resolved against the visible local catalog, never invented or created.
const LABELS = [
  [['lat pulldown', 'lat pull down', 'pulldown', 'lat machine', 'vertical traction', 'тяга сверху', 'вертикальная тяга', 'верхний блок'], ['Тяга верхнего блока']],
  [['leg extension', 'разгибание ног', 'разгибание голени'], ['Разгибание ног в тренажере']],
  [['leg curl', 'seated leg curl', 'lying leg curl', 'сгибание ног', 'сгибание голени'], ['Сгибание ног в тренажере']],
  [['leg press'], ['Жим ногами']],
  [['hip abductor', 'hip abduction', 'abductor', 'outer thigh', 'разведение ног', 'отведение бедра', 'отведение бедер'], ['Разведение ног в тренажере (Hip Abductor)']],
  [['hip adductor', 'hip adduction', 'adductor', 'inner thigh', 'сведение ног', 'приведение бедра', 'приведение бедер'], ['Сведение ног в тренажере (Hip Adductor)']],
  [['seated row', 'low row', 'cable row', 'horizontal row', 'горизонтальная тяга', 'тяга к поясу'], ['Горизонтальная тяга блока']],
  [['chest press', 'incline chest press', 'vertical chest', 'vertical press', 'жим от груди', 'жим сидя от груди'], ['Жим в тренажере Хаммер']],
  [['pec deck', 'chest fly', 'pec fly', 'pectoral', 'butterfly', 'бабочка', 'баттерфляй', 'пек дек'], ['Сведения в тренажере Бабочка']],
  [['cable crossover', 'cable cross', 'crossover', 'dual adjustable pulley', 'functional trainer', 'кроссовер'], ['Сведения в кроссовере']],
  [['reverse fly', 'rear delt', 'rear delts', 'rear deltoid', 'обратная бабочка', 'задняя дельта'], ['Обратное сведение в тренажере', 'Махи гантелями в наклоне']],
  // No machine shoulder press in the catalog yet (13.10.2026): the label stays dormant until one appears.
  [['shoulder press'], ['Жим плечами в тренажере', 'Жим в тренажере на плечи']],
  [['biceps curl', 'arm curl'], ['Сгибание рук на изолированном тренажере', 'Сгибание рук на нижнем блоке']],
  [['preacher curl', 'скамья скотта'], ['Сгибания на скамье Скотта', 'Сгибание рук на изолированном тренажере']],
  [['triceps extension', 'triceps press', 'arm extension', 'triceps pushdown', 'pushdown'], ['Разгибание рук на блоке', 'Разгибание рук на блоке с канатом']],
  [['assisted dip', 'dip assist', 'seated dip', 'triceps dip', 'dip station', 'брусья'], ['Отжимания на брусьях']],
  [['abdominal crunch', 'ab crunch', 'abdominal', 'crunch'], ['Скручивания на тренажере', 'Сгибание туловища сидя']],
  [['back extension', 'lower back', 'hyperextension'], ['Гиперэкстензия', 'Гиперэкстензия (акцент на ягодицы)']],
  [['reverse hyper'], ['Обратная гиперэкстензия']],
  // Specific calf labels first: they decide which of the two variants leads.
  [['seated calf'], ['Подъем на носки сидя']],
  [['standing calf'], ['Подъем на носки стоя']],
  [['calf raise', 'calf', 'подъем на носки'], ['Подъем на носки сидя', 'Подъем на носки стоя']],
  [['assisted pull up', 'assisted chin up', 'chin dip', 'dip chin', 'chin assist', 'гравитрон'], ['Подтягивания на тренажере', 'Отжимания на брусьях']],
  [['glute drive', 'hip thrust'], ['Ягодичный мостик в тренажере', 'Ягодичный мостик со штангой']],
  [['glute kickback', 'kickback', 'glute', 'махи назад'], ['Махи ногой назад в тренажере']],
  [['smith machine', 'smith', 'машина смита', 'тренажер смита'], ['Приседания в машине Смита', 'Жим лежа на наклонной скамье в тренажере Смита', 'Шраги в тренажере Смита']],
  [['shrug'], ['Шраги в тренажере Хаммер', 'Шраги в тренажере Смита']],
  [['rowing machine', 'rower'], ['Гребной тренажер']],
  [['treadmill', 'беговая дорожка'], ['Бег', 'Ходьба (в т.ч. в гору)']],
  [['elliptical', 'cross trainer', 'орбитрек', 'эллипс'], ['Эллипс (Орбитрек)']],
  [['bike', 'exercise bike', 'recumbent', 'indoor cycle'], ['Велотренажер']],
  [['stair climber', 'stairmaster', 'stepmill', 'stepper'], ['Степпер']],
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
