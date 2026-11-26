import { checkPlan, checkSet, FORMAT, MAX_SETS, readJsonPlan, target, validDate } from './format.js'
import { SUBMUSCLES } from '../muscles.js'

const number = String.raw`[+-]?\d+(?:[.,]\d+)?`
const reps = String.raw`\d+(?:\s*[-–—]\s*\d+)?`
const loadFirst = new RegExp('^(' + number + ')(?:\\s*[–—-]\\s*(' + number + '))?\\s*(?:кг|kg)\\s*×\\s*(' + reps + ')(?:\\s*(?:повт\\.?|reps))?$', 'iu')
const repeated = new RegExp('^(?<count>' + reps + ')\\s*×\\s*(?<goal>' + reps + ')(?:\\s*(?<unit>сек(?:унд[а-я]*)?\\.?|с|s|мин(?:ут[а-я]*)?\\.?|min|повт\\.?|reps))?(?:\\s*(?:×|@|по|с)\\s*(?<low>' + number + ')(?:\\s*[–—-]\\s*(?<high>' + number + '))?\\s*(?:кг|kg))?$', 'iu')
const duration = new RegExp('^(' + reps + ')\\s*(сек(?:унд[а-я]*)?\\.?|с|s|мин(?:ут[а-я]*)?\\.?|min)$', 'iu')
const distance = new RegExp('^(' + number + ')\\s*(?:км|km)$', 'iu')

const numeric = s => Number(s.replace(',', '.'))
function range(s, factor = 1) {
  const ns = s.split(/\s*[-–—]\s*/u).map(v => Number(v) * factor)
  return ns.length === 1 ? ns[0] : ns
}
const secondsFactor = unit => /^(мин|min)/iu.test(unit) ? 60 : 1
const normalizeTimes = s => s.replace(/(\d|кг|kg)(\s*)[xх*](?=\s*\d)/giu, '$1$2×').replace(/−/gu, '-')

function readSets(text) {
  const s = normalizeTimes(text.trim())
    .replace(/^(\d+(?:\s*[-–—]\s*\d+)?)\s+(?:подход(?:а|ов)?|sets?)\s+(?:по|of)\s+/iu, '$1×')
    .replace(/\s+повтор(?:а|ов|ений|ения)?\s+с весом\s+/iu, ' @ ')
    .replace(/\s+(?:повтор(?:а|ов|ений|ения)?|repetitions)$/iu, ' reps')
    .replace(/\s*\(([+-]?\d+(?:[.,]\d+)?(?:\s*[–—-]\s*[+-]?\d+(?:[.,]\d+)?)?\s*(?:кг|kg))\)$/iu, ' @ $1')
    .replace(/,\s+([+-]?\d+(?:[.,]\d+)?\s*(?:кг|kg))$/iu, ' @ $1')
  let m = loadFirst.exec(s)
  if (m) return [{ kg: m[2] ? [numeric(m[1]), numeric(m[2])] : numeric(m[1]), reps: range(m[3]) }]
  m = repeated.exec(s)
  if (m) {
    // Без единиц «60×8» может быть весом. Оставляем для ручной проверки.
    const { count, goal, unit, low, high } = m.groups
    const limits = range(count)
    if (!target(limits, 10)) return null
    const [min, max] = Array.isArray(limits) ? limits : [limits, limits]
    const timed = unit && !/^(повт|reps)/iu.test(unit)
    const set = timed ? { seconds: range(goal, secondsFactor(unit)) } : { reps: range(goal) }
    if (low) set.kg = high ? [numeric(low), numeric(high)] : numeric(low)
    return Array.from({ length: max }, (_, i) => ({ ...set, ...(i >= min && { optional: true }) }))
  }
  m = duration.exec(s)
  if (m) return [{ seconds: range(m[1], secondsFactor(m[2])) }]
  m = distance.exec(s)
  if (m) return [{ km: numeric(m[1]) }]
  return null
}

function cleanLine(raw) {
  return raw.replace(/&#x20;|&#32;|&nbsp;|\u00a0/giu, ' ').trim()
    .replace(/\\([#.*_|~\\-])/gu, '$1').replace(/\\$/u, '').trim()
    .replace(/(?:\s+\[\d+\])+\.?$/u, '').replace(/^#{1,6}\s+/u, '')
    .replace(/^[-+*•]\s+/u, '').replace(/^(?:\[[ xX]\]|☐|☑|✅)\s*/u, '')
    .replace(/\*\*|__/gu, '').replace(/^\*([^*]+:)\*\s*/u, '$1 ')
    .trim()
}

const numbered = /^\d{1,2}\s*[.)]\s+/u
const muscleNames = new Set(['брахиалис', 'средняя дельта', ...Object.values(SUBMUSCLES).flatMap(m => [m.major, m.label])])
const sectionEnd = /^(?:почему|дополнительно|рекомендации|(?:правила\s+)?прогресси[ия]|история|что показывает (?:твой |ваш )?журнал|пара замечаний|прошлая тренировка|прошлые результаты|разбор истории|анализ|итоги|заметки|заминка|history|previous workout|analysis|optional|cooldown|notes|recommendations)(?:$|[\s:—-])/iu
const sectionStart = /^(?:план тренировки|тренировочный чек-лист|основная часть|рабочая часть|основной блок|workout plan|main workout)\s*[:.]?$/iu
const workoutDay = /^(?:день|day|тренировка|workout)\s+(?:№\s*)?(?:\d+(?![\d.])|[A-DА-Г])(?:$|[\s:—-])/iu
const dateHeading = /^(?:тренировка|(?:скорректированный\s+)?план(?: тренировки)?|workout)(?:\s+на)?\s*[:—-]?\s*(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})$/iu
const shortPlanHeading = /^план на\s+\d{1,2}\.\d{1,2}(?![\d.])(?:\s|$)/iu
const countOnly = /^(\d{1,2})\s+подход(?:а|ов)?\.?$/iu
const barePair = new RegExp('^(' + number + ')\\s*×\\s*(' + reps + ')$', 'iu')
function weightPair(text) {
  const m = barePair.exec(normalizeTimes(text.trim()))
  return m ? { kg: numeric(m[1]), reps: range(m[2]) } : null
}

function phaseDetail(text) {
  const label = /^(разминка|разминочный|рабочие(?: подходы)?|подходы)\s*:\s*(.+)$/iu.exec(text)
  if (!label) return null
  const detail = label[2].replace(/\s*\((?:в зависимости от|твой результат)[^()]+\)/giu, '').trim()
  const sets = readSets(detail)
  if (sets && (!barePair.test(normalizeTimes(detail)) || /подходы$/iu.test(label[1]))) return { sets, warmup: /^разм/iu.test(label[1]), inferred: false }
  const parts = detail.split(/\s*→\s*/u)
  if (parts.length > 2) return null
  const list = parts[0].split(/,\s+/u)
  if (parts.length === 2) {
    const last = /^пробуй\s+(.+?)\s+в последнем$/iu.exec(parts[1])
    if (!last) return null
    list.push(last[1])
  }
  const pairs = list.map(weightPair)
  if (!pairs.every(Boolean) || !/^(рабоч|разминоч)/iu.test(label[1])) return null
  return { sets: pairs, warmup: /^разм/iu.test(label[1]), inferred: true }
}

function recommendation(ex, text) {
  const choice = text.split('→')[1]?.trim()
  if (!choice || !ex.sets.length || !ex.sets.every(s => s.reps !== undefined && s.kg === undefined)) return
  const repeat = /^(.+?)\s+во всех,\s*в последнем попробуй\s+(\d+(?:[.,]\d+)?)$/iu.exec(choice)
  const pair = weightPair(repeat ? repeat[1] : choice)
  const weight = /^(\d+(?:[.,]\d+)?)\s*[–—-]\s*(\d+(?:[.,]\d+)?)(?:\s+\(можно чередовать .+\))?$/iu.exec(choice)
  if (!pair && !weight) return
  const kg = pair?.kg ?? [numeric(weight[1]), numeric(weight[2])]
  const proposed = ex.sets.map((s, i) => ({ ...s, kg: repeat && i === ex.sets.length - 1 ? numeric(repeat[2]) : kg }))
  // При расхождении целей в заголовке и пояснении оставляем повторы из
  // заголовка. Вся рекомендация остаётся рядом с упражнением и в review.
  try { proposed.forEach(s => checkSet(s, 'Цель')) } catch { return }
  ex.sets = proposed
}
const context = /^(?:продолжительность|длительность тренировки|duration|в прошлый раз|последний раз|ранее|на прошлой|вместо|цель|разминка|перед рабочими|если|last time|previously|warm[ -]?up|\d{1,2}\.\d{1,2}(?:\.\d{4})?\s)/iu
const restLine = /^(?:[^·:]{1,40}\s*·\s*)?(?:отдых|rest)\s*:\s*(.+)$/iu
const cellsOf = s => s.replace(/^\||\|$/gu, '').split('|').map(c => c.trim())
const column = new Map([
  ['#', 'index'], ['№', 'index'], ['комментарий', 'notes'], ['comment', 'notes'],
  ['упражнение', 'name'], ['exercise', 'name'], ['подходы', 'count'], ['sets', 'count'],
  ['повторы', 'reps'], ['reps', 'reps'], ['вес', 'kg'], ['вес (кг)', 'kg'], ['weight (kg)', 'kg'],
  ['подходы × повторы', 'scheme'], ['sets × reps', 'scheme'], ['отдых', 'rest'], ['rest', 'rest'],
])

function slashSets(scheme, weight) {
  const cells = scheme.split('/').map(s => s.trim())
  if (cells.every(s => new RegExp('^' + reps + '$').test(s)) && /^[-—]$/u.test(weight)) {
    return { sets: cells.map(s => ({ reps: range(s) })) }
  }
  // В этой форме колонка «Вес» описывает изменение. Числа слева от × не
  // подписаны, поэтому обязательно возвращаем исходную строку на проверку.
  const adjustment = /плитк|[+-]\s*\d+(?:[.,]\d+)?\s*кг|^как\s+\d{1,2}\.\d{1,2}$/iu
  if (!adjustment.test(weight) || /(?:фунт|lb)/iu.test(weight)) return null
  const pair = new RegExp('^(' + number + ')\\s*×\\s*(' + reps + ')(?:\\s*\\((размин\\.|разминочный)\\))?$', 'iu')
  const sets = []
  for (const cell of cells) {
    const m = pair.exec(normalizeTimes(cell))
    if (!m) return null
    sets.push({ kg: numeric(m[1]), reps: range(m[2]), ...(m[3] && { phase: 'warmup' }) })
  }
  return { sets, warning: 'Проверь единицы: в записях через / первое число прочитано как кг' }
}

function pairedColumns(scheme, weight) {
  const m = /^(?:(\d+)\s*×\s*(\d+)\s+разм\.\s*\+\s*)?(\d+)(?:\s*[–—-]\s*(\d+))?(?:\s+рабочих)?\s*:\s*(.+)$/iu.exec(normalizeTimes(scheme))
  if (!m || m[1] && m[1] !== '1') return null
  const goals = m[5].split('/').map(s => s.trim())
  const min = Number(m[3])
  if (min < 1 || goals.length !== Number(m[4] ?? min) || goals.length < min ||
    !goals.every(s => new RegExp('^' + reps + '$').test(s))) return null
  const sets = goals.map((s, i) => ({ reps: range(s), ...(i >= min && { optional: true }) }))
  if (m[1]) sets.unshift({ phase: 'warmup', reps: Number(m[2]) })
  const parts = weight.split('→').map(s => s.trim())
  if (parts.length > 2 || !parts.every(p => p.split('/').every(s => new RegExp('^' + number + '$').test(s.trim())))) return null
  const weights = parts.flatMap(p => p.split('/').map(s => numeric(s.trim())))
  let warning
  if (weights.length !== sets.length) {
    if (parts.length !== 2 || m[1] || parts[0].includes('/') || weights.length !== sets.length + 1) return null
    weights.shift()
    warning = 'Проверь вес перед стрелкой: для рабочих подходов взяты значения после стрелки'
  }
  sets.forEach((set, i) => { set.kg = weights[i] })
  return { sets, warning }
}

function tableRow(headers, cells) {
  if (headers.length !== cells.length || headers.includes(undefined) || new Set(headers).size !== headers.length) return null
  const row = Object.fromEntries(headers.map((key, i) => [key, cells[i]]))
  if (!row.name || Boolean(row.scheme) === Boolean(row.count || row.reps)) return null
  if (!row.scheme && (!/^\d+$/u.test(row.count) || !new RegExp('^' + reps + '$').test(row.reps))) return null
  let expression = row.scheme ?? (row.count + '×' + row.reps)
  const split = expression.includes('/')
  if (!split && row.kg && !/^[-—]$/u.test(row.kg)) expression += ' @ ' + row.kg.replace(/\s*(кг|kg)$/iu, '') + ' кг'
  const sequence = split ? (expression.includes(':') ? pairedColumns : slashSets)(expression, row.kg ?? '') : null
  const sets = split ? sequence?.sets : readSets(expression)
  if (!sets) return null
  const keepWeightNote = split && (!expression.includes(':') || sequence?.warning)
  const notes = [keepWeightNote && row.kg && !/^[-—]$/u.test(row.kg) && row.kg, row.notes].filter(Boolean).join('. ')
  const restText = row.rest || /^(?:отдых|rest)\s+(.+)$/iu.exec(row.notes)?.[1]
  const rest = restText && duration.exec(restText)
  if (row.rest && !rest) return null
  if (/^если\s/iu.test(row.notes)) for (const set of sets) set.optional = true
  return { name: row.name, sets, notes, warning: sequence?.warning, ...(rest && { rest_sec: range(rest[1], secondsFactor(rest[2])) }) }
}

function parseText(source) {
  const plan = { format: FORMAT, exercises: [] }
  const review = []
  const notes = []
  const lines = source.split(/\r\n?|\n/u)
  const cleaned = lines.map(cleanLine)
  const start = cleaned.findIndex(s => dateHeading.test(s) || shortPlanHeading.test(s) || workoutDay.test(s))
  let current, headers, day
  let superset
  let paused = false
  let phase
  let setCount = 0
  const expected = []
  function flag(i, reason) { review.push({ line: i + 1, text: lines[i], reason }) }
  function note(i) { notes.push({ line: i + 1, text: lines[i], ...(current && { exercise: current.name }) }) }
  function begin(name, i) {
    current = { name, sets: [], line: i + 1 }
    if (superset) current.notes = superset
    plan.exercises.push(current)
    if (/(?:^|[\s(])(?:или|or)\s/iu.test(name)) flag(i, 'Выбери упражнение из предложенных вариантов')
  }
  function append(sets, i) {
    try {
      sets.forEach(set => checkSet(set, 'Подход'))
    } catch (e) { flag(i, e.message); return }
    setCount += sets.length
    if (setCount > MAX_SETS) throw Error('Слишком много подходов для одной тренировки')
    for (const set of sets) current.sets.push(phase && !set.phase ? { ...set, phase } : set)
  }

  for (let i = 0; i < lines.length; i++) {
    const s = cleaned[i]
    if (!s || /^[-–—_*]{3,}$/u.test(s)) continue
    if (i < start) { note(i); continue }
    if (s.length > 1500) { flag(i, 'Длинная строка требует проверки'); current = null; headers = null; continue }
    const date = dateHeading.exec(s)
    const shortDate = shortPlanHeading.test(s)
    if (date || shortDate || workoutDay.test(s)) {
      const id = s.toLowerCase()
      if (day && id !== day) throw Error('В тексте несколько тренировок. Вставь один день за раз.')
      day = id
      if (date) {
        const iso = date[1].includes('.') ? date[1].split('.').reverse().join('-') : date[1]
        if (validDate(iso)) plan.date = iso
        else flag(i, 'Проверь дату')
      }
      if (shortDate) flag(i, 'Проверь год запланированной тренировки')
      paused = false; current = null; headers = null; phase = undefined
      continue
    }
    const heading = s.replace(numbered, '').replace(/:$/u, '')
    if (numbered.test(s) || sectionStart.test(heading) || sectionEnd.test(s)) superset = null
    if (!paused && numbered.test(s) && s.endsWith(':') && !/^(?:разминка|заминка)$/iu.test(heading)) {
      current = null; headers = null; phase = undefined
      if (/^суперсет(?:\s|$)/iu.test(heading)) superset = heading
      // Только заголовки групп. Обычное «1. Жим лёжа:» открывает упражнение.
      const groupName = heading.toLowerCase().split(/[\s(/]/u)[0]
      if (superset || muscleNames.has(groupName) || groupName === 'руки') continue
    }
    if (day && /^\s*\\?#{1,6}\s/u.test(lines[i]) && heading.toLowerCase().split(/\s+и\s+/u).every(n => muscleNames.has(n) || n === 'заминка') && !/^(?:разминка|заминка)$/iu.test(heading)) {
      paused = false; phase = undefined; current = null; headers = null; continue
    }
    if (/^(?:на следующий раз|если хочешь вместо)(?:\s|$)/iu.test(heading)) {
      current = null
      for (; i < lines.length; i++) if (cleaned[i]) note(i)
      break
    }
    if (/^(?:разминка|заминка)\s*\([\d\s–—-]+мин\)$/iu.test(heading)) {
      // В этих блоках несколько действий могут описываться одной строкой.
      phase = undefined; current = null; headers = null; paused = true
      note(i); continue
    }
    if (sectionStart.test(heading)) { paused = false; current = null; headers = null; phase = undefined; continue }
    if (numbered.test(s) && /^(?:разминка|заминка)$/iu.test(heading)) {
      phase = /^разминка$/iu.test(heading) ? 'warmup' : 'cooldown'
      current = null; headers = null; paused = false; continue
    }
    if (sectionEnd.test(s) || /^(?:разминка|warm[ -]?up)\s*:?$/iu.test(s)) {
      paused = true; current = null; headers = null
    }
    if (!paused) {
      if (current && /^(?:разминка|разминочный|рабочие(?: подходы)?|подходы)\s*:\s*.+/iu.test(s)) {
        const detail = phaseDetail(s)
        if (detail) {
          append(detail.sets.map(set => detail.warmup ? { ...set, phase: 'warmup' } : set), i)
          if (s.includes('(') || detail.inferred) current.notes = [current.notes, s].filter(Boolean).join('\n')
          if (detail.inferred) flag(i, 'Проверь веса без подписи кг для «' + current.name + '»')
        } else flag(i, 'Проверь назначение для «' + current.name + '»')
        continue
      }
      if (current && (/^(?:было\s|ориентир:)/iu.test(s) || /(?:схема|результат)\s+от\s+\d/iu.test(s))) {
        current.notes = [current.notes, s].filter(Boolean).join('\n')
        recommendation(current, s)
        if (s.includes('→') || s.includes('цель')) flag(i, 'Проверь рекомендацию для «' + current.name + '»')
        current = null
        continue
      }
      const counter = /^(\d+)\s+из\s+(\d+)(?:\s+подходов)?$/iu.exec(s)
      if (counter) { expected.push({ i, count: Number(counter[2]), kind: 'sets' }); continue }
      if (/^(?:упражнения|рабочие подходы)$/iu.test(s) && /^\d+$/u.test(cleaned[i + 1])) {
        expected.push({ i, count: Number(cleaned[i + 1]), kind: /^упр/iu.test(s) ? 'exercises' : 'sets' })
        i++
        continue
      }
      if (/^(?:продолжительность|duration)$/iu.test(s) && duration.test(cleaned[i + 1])) {
        note(i); note(++i); current = null; continue
      }
      if (current?.sets.length && (/^(?:если|if)\s/iu.test(s) || !context.test(s) && /[,;]\s*если\s/iu.test(s))) {
        current.notes = [current.notes, s].filter(Boolean).join('\n')
        flag(i, 'Проверь условие для «' + current.name + '»')
        current = null
        continue
      }
      if (current?.sets.length && /^(?:контролируй|без рывков|вес каждой|сокращай|закрепляем)\s/iu.test(s)) {
        current.notes = [current.notes, s].filter(Boolean).join('\n')
        continue
      }
    }
    if (paused || context.test(s)) { note(i); current = null; headers = null; continue }

    if (s.includes('|') || s.includes('\t')) {
      const cells = s.includes('|') ? cellsOf(s) : s.split('\t').map(c => c.trim())
      const names = cells.map(c => column.get(c.toLowerCase()))
      current = null
      if (names.includes('name')) { headers = names; continue }
      if (cells.every(c => /^:?-+:?$/u.test(c))) continue
      const row = headers && tableRow(headers, cells)
      if (!row || ('rest_sec' in row && !target(row.rest_sec, 86400))) { flag(i, 'Проверь строку таблицы и единицы'); continue }
      begin(row.name, i)
      if (row.notes) current.notes = row.notes
      if (row.warning) flag(i, row.warning)
      if (/(?:^|[\s.])если\s/iu.test(row.notes)) flag(i, 'Проверь условие для «' + row.name + '»')
      if ('rest_sec' in row) current.rest_sec = row.rest_sec
      append(row.sets, i)
      continue
    }
    headers = null
    const group = /^(\d+)(?:\s*[–—-]\s*(\d+))?\s+подход(а|ов|ы)?\s*:\s*(.+)$/iu.exec(s)
    if (group) {
      const first = Number(group[1])
      const last = group[2] ? Number(group[2]) : null
      const ordinal = last !== null || !group[3]
      const count = ordinal ? (last ?? first) - first + 1 : first
      const warmup = /\s*\(разминочный\)$/iu
      const items = readSets(group[4].replace(warmup, ''))
      if (!current || count < 1 || count > 100 || (ordinal && first !== current.sets.length + 1) || items?.length !== 1) {
        flag(i, 'Проверь номера, число подходов и единицы')
      } else {
        append(Array.from({ length: count }, () => ({ ...items[0], ...(warmup.test(group[4]) && { phase: 'warmup' }) })), i)
      }
      continue
    }
    const rest = restLine.exec(s)
    if (rest) {
      const m = duration.exec(rest[1])
      const value = m && range(m[1], secondsFactor(m[2]))
      if (current && target(value, 86400)) current.rest_sec = value
      else flag(i, 'Проверь отдых')
      continue
    }
    const sets = readSets(s)
    if (sets) {
      if (current) append(sets, i)
      else flag(i, 'У подхода нет упражнения')
      continue
    }
    let title = s.replace(numbered, '')
    if (numbered.test(s) && muscleNames.has(title.split(':')[0].toLowerCase()) && title.includes(':')) {
      title = title.slice(title.indexOf(':') + 1).trim()
    }
    if (numbered.test(s) && title.toLowerCase().split(/,\s*/u).every(n => muscleNames.has(n)) && !readSets(cleaned[i + 1] ?? '')) {
      current = null
      continue
    }
    const inline = /^(.+?)(?:\s+[—–-]\s+|:\s*|\s+(?=\d+\s*[×xх*]))(.+)$/iu.exec(title)
    if (inline && /\p{L}/u.test(inline[1]) && !/[.!?]/u.test(inline[1])) {
      const declared = countOnly.exec(inline[2])
      if (declared && Number(declared[1]) > 0) {
        const variants = /^(.+?)\s+\(([^()]+)\)(?:\s+\[\d+\])?\s+или\s+(.+?)\s+\(([^()]+)\)(?:\s+\[\d+\])?$/iu.exec(inline[1])
        const first = variants && readSets(variants[2])
        if (first?.length === 1 && readSets(variants[4])?.length === 1) {
          begin(variants[1], i)
          append(Array.from({ length: Number(declared[1]) }, () => ({ ...first[0] })), i)
          current.notes = 'Вариант на выбор: ' + variants[3] + ' (' + variants[4] + ')'
          flag(i, 'Выбери одно упражнение из двух')
        } else {
          begin(inline[1], i)
          current.declared = Number(declared[1])
        }
        continue
      }
      const alternative = /^(.+?)\s+\((или\s+.+)\)$/iu.exec(inline[2])
      const detail = phase && /^(.+?\s(?:минут[а-я]*|секунд[а-я]*))\s+(в\s+.+)$/iu.exec(inline[2])
      const targets = readSets(alternative?.[1] ?? (detail ? detail[1] : inline[2]))
      if (targets) {
        begin(inline[1].trim(), i); append(targets, i)
        if (detail) current.notes = detail[2]
        if (alternative) { current.notes = alternative[2]; flag(i, 'Выбери основной вариант или замену') }
        continue
      }
    }
    const titleLike = !inline && /^\p{L}[^:;!?.×|]{0,100}$/u.test(title.replace(/:$/u, ''))
    let next = i + 1
    while (next < cleaned.length && !cleaned[next]) next++
    if (titleLike && (numbered.test(s) || readSets(cleaned[next] ?? '') || restLine.test(cleaned[next] ?? ''))) {
      begin(title.replace(/:$/u, ''), i); continue
    }
    // Незнакомая строка может быть заголовком нового упражнения. Не приклеиваем
    // последующие подходы к предыдущему упражнению через такую границу.
    flag(i, 'Строка не разобрана')
    current = null
  }
  plan.exercises = plan.exercises.filter(ex => {
    if (ex.declared) {
      const missing = ex.declared - ex.sets.length
      if (missing !== 0) flag(ex.line - 1, 'Заявлено подходов: ' + ex.declared + ', с разобранными целями: ' + ex.sets.length)
      if (missing > 0) {
        setCount += missing
        if (setCount > MAX_SETS) throw Error('Слишком много подходов для одной тренировки')
        ex.sets.push(...Array.from({ length: missing }, () => ({ pending: true })))
      }
      delete ex.declared
    }
    if (!ex.sets.length) flag(ex.line - 1, 'Не разобраны подходы упражнения')
    return ex.sets.length > 0
  })
  for (const ex of plan.exercises) delete ex.line
  for (const { i, count, kind } of expected) {
    const actual = kind === 'sets'
      ? plan.exercises.reduce((n, ex) => n + ex.sets.filter(s => !s.phase || s.phase === 'work').length, 0)
      : plan.exercises.length
    if (count !== actual) flag(i, 'В тексте указано ' + count + ', распознано ' + actual)
  }
  if (!plan.exercises.length) throw Error('Не удалось выделить упражнения с подходами. ' + (review[0]?.text ?? 'Проверь исходный текст.'))
  return { plan: checkPlan(plan), review, notes }
}

export function parseWorkoutPlan(input) {
  const source = input.trim().replace(/^\uFEFF/u, '')
  if (!source || source.length > 200000) throw Error('Нужен текст одной тренировки длиной до 200 000 символов')
  const fences = [...source.matchAll(/^\s*\x60{3}(json)?[ \t]*\r?\n([\s\S]*?)^[ \t]*\x60{3}[ \t]*\r?$/gimu)]
  const json = fences.filter(m => m[1] || /^[{[]/u.test(m[2].trim()))
  if (json.length > 1) throw Error('Найдено несколько блоков JSON. Вставь один план.')
  const body = source.replace(/^[^\r\n]+\(\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}\):\s*\r?\n(?=\s*\{)/u, '')
  if (json.length || /^[{[]/u.test(body) && !/^\[[ xX]\]/u.test(body)) {
    const plan = readJsonPlan(JSON.parse(json[0]?.[2] ?? body))
    return { plan, review: [], notes: [] }
  }
  return parseText(source)
}
