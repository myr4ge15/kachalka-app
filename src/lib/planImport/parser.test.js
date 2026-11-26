import { test } from 'vitest'
import assert from 'node:assert/strict'
import { parseWorkoutPlan as parse } from './parser.js'
import { matchExport, checkLastWorkout } from './catalog.js'
import { acceptsTargets, planEntry, matchExercise, describeTarget } from './draft.js'

const parseSets = text => parse(text).plan.exercises.flatMap(e => e.sets)
const jsonPlan = { format: 'workout-plan/v1', exercises: [{ name: 'Жим', sets: [{ kg: 25, reps: [6, 8] }] }] }

test('JSON из переписки без метки формата переносит вес и повторы', () => {
  const raw = { name: 'Full Body', date: '2026-11-26', exercises: [{ name: 'Жим', sets: [{ weight: 60, reps: 9 }] }] }
  const result = parse('Участник (26.11.2026 11:38):\n' + JSON.stringify(raw)).plan
  assert.deepEqual(result, { ...jsonPlan, name: raw.name, date: raw.date, exercises: [{ name: 'Жим', sets: [{ kg: 60, reps: 9 }] }] })
})

test('JSON с entries сохраняет порядок, разминку, отдых, диапазоны, заметки и необязательную заминку', () => {
  const raw = { schema: jsonPlan.format, date: '2026-11-26', status: 'planned', working_sets: 2,
    duration_minutes: { min: 65, max: 80 }, notes: 'Вес на одну гантель',
    warmup: { exercise: { name: 'Эллипс', id: 'el' }, duration_seconds: 300 },
    entries: [{ exercise: { id: 'pr', name: 'Жим', muscle_group: 'грудь', metric: 'weight' },
      sets: [{ weight: 60, reps: 9 }, { weight: 60, reps: 8, reps_max: 9 }], rest_seconds: 180, warmup_sets: [{ weight: 20, reps: 12 }] }],
    optional_cooldown: { name: 'Ходьба', duration_minutes: { min: 10, max: 15 },
      speed_kmh: { min: 4.5, max: 5.5 }, incline_percent: { min: 3, max: 5 } } }
  const plan = parse(JSON.stringify(raw)).plan
  assert.deepEqual(plan.exercises, [
    { name: 'Эллипс', exercise_id: 'el', sets: [{ seconds: 300, phase: 'warmup' }] },
    { name: 'Жим', exercise_id: 'pr', rest_sec: 180, sets: [{ kg: 20, reps: 12, phase: 'warmup' }, { kg: 60, reps: 9 }, { kg: 60, reps: [8, 9] }] },
    { name: 'Ходьба', sets: [{ seconds: [600, 900], phase: 'cooldown', optional: true }], notes: 'Скорость 4.5–5.5 км/ч\nУклон 3–5%' },
  ])
  assert.equal(plan.notes, 'Длительность 65–80 мин\nВес на одну гантель')
  for (const invalid of [{ status: 'completed' }, { working_sets: 3 }, { entries: [] },
    { entries: [{ exercise: { name: 'Жим' }, sets: [] }] }, { entries: [{ exercise: { name: 'Жим' }, sets: [{ weight: 60, reps: 8, reps_max: 5 }] }] },
    { duration_minutes: { min: 30, max: '40' } }, { unexpected: 1 }]) {
    assert.throws(() => parse(JSON.stringify({ ...raw, ...invalid })))
  }
})
test('Текст с итогами прошлого дня, деталями следующего и альтернативной программой', () => {
  const r = parse('Последняя сессия прошла 19 ноября 2026 года\nЖим: 80 кг × 3\nСкорректированный план на 26.11.2026\n' +
    '1. Ноги: Присед — 3 подхода\nРазминочный: 20×15\nРабочие: 35×10 (твой результат в журнале) → пробуй 40×8 в последнем\n' +
    'Тяга — 2–3×12\nБыло 35×10 → 40×12 во всех, в последнем попробуй 45\nПресс: 2 подхода\n' +
    '12×10 — схема от 19.11, цель +2\nЕсли хочешь вместо ног — верх\nЖим: 3×15')
  assert.deepEqual(r.plan.exercises.map(e => e.name), ['Присед', 'Тяга', 'Пресс'])
  assert.deepEqual(r.plan.exercises[0].sets, [{ kg: 20, reps: 15, phase: 'warmup' }, { kg: 35, reps: 10 }, { kg: 40, reps: 8 }])
  assert.deepEqual(r.plan.exercises[1].sets.at(-1), { kg: 45, reps: 12, optional: true })
  assert.deepEqual(r.plan.exercises[2].sets, [{ pending: true }, { pending: true }])
  assert.deepEqual(parse(JSON.stringify(r.plan)).plan, r.plan)
  const workouts = [{ performed_at: '2026-11-23T14:00:00Z' }, {}, { performed_at: '2026-11-19' }]
  checkLastWorkout(r, 'Последняя сессия прошла **19 ноября 2026 года**.', workouts)
  assert.match(r.review.at(-1).reason, /19\.11\.2026.+23\.11\.2026/u)
  const ok = { review: [] }
  checkLastWorkout(ok, 'Последняя зафиксированная тренировка состоялась 23.11.2026', workouts)
  assert.deepEqual(ok.review, [])
})

test('Вложенные строки, суперсет, альтернативы и диапазоны сохраняют единицы и фазу', () => {
  const r = parse('План на 05.05.2027\n1. Разминка:\nБег — 2 минуты\n2. Основная часть\n1. Грудь: Жим\n' +
    'Разминка: 20 кг × 10 повторений\nРабочие подходы: 2 × 8–12 повторений с весом 35–45 кг (в зависимости от самочувствия)\n' +
    '2. Суперсет на руки:\nСгибания: 2×12 (8–10 кг)\nРазгибания: 2×12 (6 кг)\n3. Кор / Пресс:\n' +
    'Планка (20 сек) или Уголок (10 сек) — 2 подхода.\n4. Заминка:\nШаг — 3 минуты')
  assert.deepEqual(r.plan.exercises[1].sets, [{ kg: 20, reps: 10, phase: 'warmup' }, ...Array(2).fill({ kg: [35, 45], reps: [8, 12] })])
  assert.equal(r.plan.exercises[2].notes, r.plan.exercises[3].notes)
  assert.match(r.plan.exercises[3].notes, /Суперсет/u)
  assert.match(r.plan.exercises[4].notes, /Уголок/u)
  assert.deepEqual(r.plan.exercises.at(-1).sets, [{ seconds: 180, phase: 'cooldown' }])
})

test('Столбцы с весами и запись через / не смешивают количество и вес', () => {
  const { plan, review } = parse('| Упражнение | Подходы × повторы | Вес | Комментарий |\n' +
    '| Жим | 20×10 (размин.) / 25×8 | +1 плитка | техника |\n| Тяга | 2–3: 9 / 8 / 7 | 10 / 12 / 14 | |\n' +
    '| Присед | 1×10 разм. + 2 рабочих: 9 / 8 | 20 → 30 / 32 | |\n| Махи | 2: 9 / 8 | 4 → 6 / 6 | |\n' +
    '| Пресс | 10 / 8 | — | если останутся силы |')
  assert.equal(plan.exercises[0].sets[0].phase, 'warmup')
  assert.equal(plan.exercises[1].sets[2].optional, true)
  assert.equal(plan.exercises[2].sets[2].kg, 32)
  assert.ok(review.some(r => r.reason.includes('стрелкой')))
  assert.ok(plan.exercises[4].sets.every(s => s.optional))
})

test('Черновик сохраняет цели и пустые диапазоны, сверяет метрику каталога', () => {
  const ex = { name: 'Планка', id: 'a', metric: 'time' }
  const item = { name: 'Планка', sets: [{ seconds: 60, phase: 'warmup' }], rest_sec: [30, 45] }
  assert.equal(matchExercise(item, [ex]), 'a')
  assert.equal(matchExercise({ ...item, exercise_id: 'other' }, [ex]), '')
  assert.equal(matchExercise({ ...item, exercise_id: 'a' }, [ex]), 'a')
  assert.equal(matchExercise(item, [ex, { ...ex, id: 'b' }]), '')
  assert.equal(acceptsTargets({ metric: 'weight' }, item), false)
  const entry = planEntry({ ...ex, planTarget: item })
  assert.deepEqual(entry.exercise, ex)
  assert.equal(entry.phase, 'warmup')
  assert.equal(entry.planNote, 'Отдых 30–45 с')
  assert.equal(entry.sets[0].reps, 60)
  const run = planEntry({ metric: 'distance', planTarget: { sets: [{ km: 2, seconds: 600 }, { seconds: [30, 45], optional: true }] } })
  assert.equal(run.sets[0].weight, 2)
  assert.equal(run.sets[1].reps, '')
  assert.equal(describeTarget({ pending: true }), 'Уточнить цель')
  assert.match(describeTarget({ phase: 'cooldown', seconds: 30 }), /заминка/u)
  assert.equal(acceptsTargets(ex, { sets: [{ kg: -5, seconds: 60 }] }), false)
  assert.equal(acceptsTargets(ex, { sets: [{ km: 2 }] }), false)
})

test('Инструкции между группами подходов, отдых и контекст следующего дня', () => {
  const r = parse('Тренировка — 21.03.2027\nПродолжительность\n55–65 мин\nТренировочный чек-лист\n1. Ноги\nТяга\n' +
    'Ноги · Отдых: 2 минуты\n1 подход: 10 кг × 15 повторений (разминочный)\n2–3 подходы: 25 кг × 10 повторений\n' +
    'Контролируй движение\nДобавь третий подход, если осталось время\n2. Жим\n3 подхода: 30 кг × 12\n' +
    'Другой вариант: 2 × 10 (или замена)\nДополнительно: прогулка\nНа следующий раз\nТяга: 55 кг × 8')
  assert.equal(r.plan.exercises[0].rest_sec, 120)
  assert.deepEqual(r.plan.exercises[0].sets, [{ kg: 10, reps: 15, phase: 'warmup' }, ...Array(2).fill({ kg: 25, reps: 10 })])
  assert.match(r.plan.exercises[0].notes, /третий подход/u)
  assert.equal(r.plan.exercises[1].sets.length, 3)
  assert.equal(r.plan.exercises[2].notes, 'или замена')
})

test('Подписи мышц, пояснение к кардио, подсказка о числе строк и заметки таблицы', () => {
  const r = parse('План на 01.03 — ноги\n1. Разминка\nХодьба — 5 минут в спокойном темпе\n## Ноги\n' +
    '| Упражнение | Sets | Reps | Вес | Отдых |\n| Жим | 2 | 8 | — | 30–40 с |\n' +
    'Присед: 2×6\nБыло 10×5 → 15–20 (можно чередовать с другим)\nРазминка (5 мин)\nСвободная прогулка')
  assert.equal(r.plan.exercises[0].notes, 'в спокойном темпе')
  assert.deepEqual(r.plan.exercises[1].rest_sec, [30, 40])
  assert.deepEqual(r.plan.exercises[2].sets[0], { kg: [15, 20], reps: 6 })
})

test('Повреждённые блоки не меняют другие упражнения и не расширяют план сверх лимита', () => {
  const r = parse('Тяга: 2×10\nРабочие: 20×10 → непонятно\nРабочие: 20×10 → 30×8 → 35×5\n4–5 подходы: 30 кг × 8\n' +
    '| Упражнение | Подходы × повторы | Вес |\n| А | 3: 8 / 7 | 20 / 25 |\n| Б | 2: 8 / 7 | 20 / 25 / 30 |\n| В | 20×8 / 25×7 | +5 lb |')
  assert.equal(r.review.length, 6)
  assert.throws(() => parse('  '))
  assert.throws(() => parse('совет'), /выделить/)
  assert.throws(() => parse('Тяга: 99 подходов\n'.repeat(11)), /Слишком много/)
  assert.throws(() => parse('Тяга: 10×10\n'.repeat(101)), /Слишком много/)
  const bad = [
    { name: 1 }, { date: '2027-02-30' }, { exercises: [] }, { exercises: [null] },
    { exercises: [{ name: '', sets: [] }] }, { exercises: [{ name: 'А', sets: [] }] },
    { exercises: [{ name: 'А', notes: 7, sets: [] }] },
    { exercises: [{ name: 'А', sets: [{}], rest_sec: -1 }] },
  ]
  for (const overrides of bad) assert.throws(() => parse(JSON.stringify({ ...jsonPlan, ...overrides })))
  for (const set of [{ pending: true, kg: 2 }, { seconds: -1 }, { km: -1 }, { reps: 1, phase: 'other' }, { reps: 1, optional: 2 }, { kg: [5, 3], reps: 4 }]) {
    assert.throws(() => parse(JSON.stringify({ ...jsonPlan, exercises: [{ name: 'А', sets: [set] }] })))
  }
})
test('Сверяет объявленные итоги с результатом и принимает вес в скобках', () => {
  const r = parse('Упражнения\n2\n0 из 3\nЖим: 2×8 (62,5 кг)')
  assert.deepEqual(r.plan.exercises[0].sets, Array(2).fill({ kg: 62.5, reps: 8 }))
  assert.deepEqual(r.review.map(i => i.reason), ['В тексте указано 2, распознано 1', 'В тексте указано 3, распознано 2'])
})

test('Русские и английские записи, десятичная запятая, пустой вес, гравитрон', () => {
  assert.deepEqual(parseSets('**Жим** — 2х8–10 @ 62,5 кг\nPull-ups: 2 sets of 6 reps\n1) Гравитрон\n−20 кг × 12'), [
    { kg: 62.5, reps: [8, 10] }, { kg: 62.5, reps: [8, 10] }, { reps: 6 }, { reps: 6 }, { kg: -20, reps: 12 },
  ])
  assert.deepEqual(parseSets('Присед: 3 подхода по 8 повторений'), Array(3).fill({ reps: 8 }))
})

test('Отдельная строка после пустой, время, дистанция, дробные километры', () => {
  assert.deepEqual(parseSets('Планка\n\n2 × 30–45 сек\nБег: 2,5 км'), [{ seconds: [30, 45] }, { seconds: [30, 45] }, { km: 2.5 }])
})

test('Markdown и табличный текст из буфера, порядок столбцов произвольный', () => {
  const md = '| Вес (кг) | Подходы | Упражнение | Повторы | Отдых |\n|---|---|---|---|---|\n| 12,5 | 2 | Сгибание | 8–10 | 1 мин |'
  const tsv = 'Упражнение\tПодходы × повторы\tВес\tОтдых\nСгибание\t2x8–10\t12,5 кг\t60 с'
  assert.deepEqual(parse(md).plan, parse(tsv).plan)
  assert.deepEqual(parse(md).plan.exercises[0], { name: 'Сгибание', sets: Array(2).fill({ kg: 12.5, reps: [8, 10] }), rest_sec: 60 })
})

test('Непонятные строки видны, подходы через неизвестное упражнение не склеиваются', () => {
  const { plan, review } = parse('Жим: 60 кг × 8\nТяга — сколько сможешь\n45 кг × 9\nПрисед: 2×6')
  assert.equal(plan.exercises[0].sets.length, 1)
  assert.deepEqual(review.map(r => r.line), [2, 3])
  assert.equal(plan.exercises[1].name, 'Присед')
})

test('Данные истории, разминка и будущая прогрессия в соседних блоках не становятся рабочими', () => {
  assert.deepEqual(parseSets('История\nЖим: 80 кг × 8\nОсновная часть\nЖим: 65 кг × 8\nВ прошлый раз:\n75 кг × 8\nРазминка:\nЖим: 20 кг × 8\nПрогрессия\nЖим: 90 кг × 6'), [{ kg: 65, reps: 8 }])
})

test('Неподписанные большие числа, убывающие диапазоны и строки с конфликтом единиц', () => {
  const r = parse('Жим: 2×8\n60×8\n1. Планка\n2×45–30 сек\n|Exercise|Sets|Reps|Weight (lb)|\n|Bench|2|5|155|')
  assert.deepEqual(r.plan.exercises, [{ name: 'Жим', sets: Array(2).fill({ reps: 8 }) }])
  assert.ok(r.review.some(e => e.line === 2))
  assert.ok(r.review.some(e => e.line === 4))
  assert.ok(r.review.some(e => e.line === 6))
})

test('Одна тренировка за раз, ошибочная дата видна', () => {
  assert.throws(() => parse('День 1\nЖим: 3×8\nДень 2\nПрисед: 3×8'), /несколько/)
  assert.equal(parse('Тренировка — 31.02.2026\nЖим: 2×8').review[0].line, 1)
})

test('Чистый JSON и блок JSON среди пояснений идентичны', () => {
  const json = JSON.stringify(jsonPlan)
  const fence = '\x60\x60\x60'
  assert.deepEqual(parse(json), parse('План\n' + fence + 'json\n' + json + '\n' + fence + '\nУдачи!'))
  assert.deepEqual(parse(json).plan, jsonPlan)
  const two = [json, json].map(p => fence + 'json\n' + p + '\n' + fence).join('\n')
  assert.throws(() => parse(two), /несколько/)
})

test('Стандарт позволяет явно сохранить разминку, заметки и кардио', () => {
  const plan = { format: jsonPlan.format, date: '2028-02-29', notes: 'На завтра', exercises: [
    { name: 'Бег', sets: [{ phase: 'warmup', km: 1.2, seconds: 600 }] },
    { name: 'Планка', notes: 'На локтях', rest_sec: [30, 45], sets: [{ kg: 5, seconds: [30, 40] }] },
  ] }
  assert.deepEqual(parse(JSON.stringify(plan)).plan, plan)
})

test('Некорректный JSON или чужая схема не проходят как свободный текст', () => {
  for (const invalid of ['{invalid', '[]', '{"schema":"workouts-export/v1","workouts":[]}', '{"format":"workout-plan/v2","exercises":[]}']) {
    assert.throws(() => parse(invalid))
  }
  for (const set of [{}, { kg: '60', reps: 8 }, { reps: [10, 8] }, { reps: 0 }, { reps: 8, km: 2 }, { kg: 60, reps: 8, rir: 2 }]) {
    assert.throws(() => parse(JSON.stringify({ ...jsonPlan, exercises: [{ name: 'Жим', sets: [set] }] })))
  }
})

test('Сопоставление по истории учитывает ё, повторы одного ID и совпадение имён', () => {
  const exercises = [{ name: 'Жим лёжа', id: 'a' }, { name: 'Жим лёжа', id: 'a' }, { name: 'Тяга', id: 'b' }, { name: 'Тяга', id: 'c' }]
  const history = { schema: 'workouts-export/v1', workouts: [{ entries: exercises.map(exercise => ({ exercise })) }] }
  const r = matchExport(parse('Жим лежа: 2×8\nТяга: 2×6\nПланка: 30 сек'), history)
  assert.deepEqual(r.plan.exercises.map(e => e.exercise_id), ['a', undefined, undefined])
  assert.deepEqual(r.review.map(e => e.text), ['Тяга', 'Планка'])
  assert.throws(() => matchExport(r, {}), /выгрузка/)
  assert.equal(matchExport(parse(JSON.stringify(r.plan)), history).plan.exercises[0].exercise_id, 'a')
})
