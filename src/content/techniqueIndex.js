// ============================================================================
// Индекс подсказок по технике (v8.0.0, docs/plans/PLAN-exercise-technique-hints.md).
//
// Лёгкая часть справочника: какие упражнения каталога имеют подсказку. Лежит в
// основном бандле — по нему решается, показывать ли кнопку «Как выполнять».
// Тексты и кадры — в src/content/technique.js (ленивый чанк, грузится по нажатию).
//
// Привязка — по ТОЧНОМУ названию общего упражнения каталога, а не по id: id —
// случайный UUID, разный на проде, в bootstrap и на self-hosted инстансе (как
// словарь сканера, lib/scannerMatch.js LABELS). Нечеткого сравнения нет: разные
// варианты упражнения не должны получать одну демонстрацию.
//
// ⚠️ Переименовал общее упражнение в админке — поправь название здесь, иначе
// подсказка молча пропадет. Названия — через «е» (v7.4.1).
// ============================================================================

export const TECHNIQUE_INDEX = [
  { slug: 'bench-press', names: ['Жим лежа со штангой'] },
  { slug: 'dumbbell-bench-press', names: ['Жим гантелей лежа'] },
  { slug: 'back-squat', names: ['Приседания со штангой'] },
  { slug: 'deadlift', names: ['Становая тяга'] },
  { slug: 'romanian-deadlift', names: ['Румынская тяга'] },
  // v8.4.0: сгибания — одна схема названий (catalog-2026-10c.sql); прежнее имя — до наката.
  { slug: 'barbell-curl', names: ['Сгибание рук со штангой', 'Подъем штанги на бицепс'] },
  { slug: 'lateral-raise', names: ['Махи гантелями в стороны'] },
  { slug: 'pull-up', names: ['Подтягивания'] },
  { slug: 'seated-cable-row', names: ['Горизонтальная тяга блока'] },
  { slug: 'triceps-pushdown', names: ['Разгибание рук на блоке'] },
  { slug: 'leg-press', names: ['Жим ногами'] },
  { slug: 'leg-extension', names: ['Разгибание ног в тренажере'] },
  { slug: 'hyperextension', names: ['Гиперэкстензия'] },
  { slug: 'lat-pulldown', names: ['Тяга верхнего блока'] },
  { slug: 'pec-deck', names: ['Сведения в тренажере Бабочка'] },
  // Партия 2 (v8.3.0). «Подъем рук перед собой стоя» — прежнее название (до
  // технической миграции); сгибание ног — после разделения на лежа/сидя.
  { slug: 'incline-bench-press', names: ['Жим лежа на наклонной скамье'] },
  { slug: 'incline-dumbbell-press', names: ['Жим гантелей лежа на наклонной скамье'] },
  { slug: 'dumbbell-fly', names: ['Разведение гантелей лежа'] },
  { slug: 'cable-crossover', names: ['Сведения в кроссовере'] },
  { slug: 'chest-dips', names: ['Отжимания на брусьях'] },
  { slug: 'push-up', names: ['Отжимания от пола'] },
  { slug: 'hammer-chest-press', names: ['Жим в тренажере Хаммер'] },
  { slug: 'dumbbell-curl', names: ['Сгибание рук с гантелями', 'Подъем гантелей на бицепс'] },
  { slug: 'hammer-curl', names: ['Молотковые сгибания'] },
  { slug: 'cross-body-hammer-curl', names: ['Молотковые сгибания крест накрест'] },
  { slug: 'preacher-curl', names: ['Сгибание рук на скамье Скотта', 'Сгибания на скамье Скотта'] },

  { slug: 'cable-curl', names: ['Сгибание рук на нижнем блоке'] },
  { slug: 'machine-curl', names: ['Сгибание рук на изолированном тренажере'] },
  { slug: 'close-grip-bench-press', names: ['Жим штанги узким хватом'] },
  { slug: 'skull-crusher', names: ['Французский жим'] },
  { slug: 'rope-pushdown', names: ['Разгибание рук на блоке с канатом'] },
  { slug: 'seated-dip-machine', names: ['Отжимания сидя в тренажере'] },
  { slug: 'front-raise', names: ['Подъем гантелей перед собой', 'Подъем рук перед собой стоя'] },
  { slug: 'rear-delt-raise', names: ['Махи гантелями в наклоне'] },
  { slug: 'upright-row', names: ['Тяга штанги к подбородку'] },
  { slug: 'barbell-shrug', names: ['Шраги со штангой стоя'] },
  { slug: 'dumbbell-shrug', names: ['Шраги с гантелями стоя'] },
  { slug: 'smith-shrug', names: ['Шраги в тренажере Смита'] },
  { slug: 'bent-over-row', names: ['Тяга штанги в наклоне'] },
  { slug: 'lever-row', names: ['Тяга в рычажном тренажере'] },
  { slug: 'smith-squat', names: ['Приседания в машине Смита'] },
  { slug: 'good-morning', names: ['Доброе утро'] },
  { slug: 'lying-leg-curl', names: ['Сгибание ног лежа в тренажере'] },
  { slug: 'seated-leg-curl', names: ['Сгибание ног сидя в тренажере'] },
  { slug: 'lunges', names: ['Выпады (классические/назад)'] },
  { slug: 'seated-calf-raise', names: ['Подъем на носки сидя'] },
  { slug: 'standing-calf-raise', names: ['Подъем на носки стоя'] },
  { slug: 'hack-squat', names: ['Гакк-приседания'] },
  { slug: 'hip-adductor', names: ['Сведение ног в тренажере (Hip Adductor)'] },
  { slug: 'box-squat', names: ['Приседания на опору'] },
  { slug: 'step-up', names: ['Зашагивания на тумбу'] },
  { slug: 'hip-abductor', names: ['Разведение ног в тренажере (Hip Abductor)'] },
  { slug: 'cable-kickback', names: ['Отведение ноги назад в кроссовере'] },
  { slug: 'glute-hyperextension', names: ['Гиперэкстензия (акцент на ягодицы)'] },
  { slug: 'crunch', names: ['Скручивания'] },
  { slug: 'machine-crunch', names: ['Скручивания на тренажере'] },
  { slug: 'side-plank', names: ['Боковая планка'] },
  { slug: 'side-bend', names: ['Наклоны в сторону с гантелью'] },
  { slug: 'ab-rollout', names: ['Ролик для пресса'] },
  { slug: 'arnold-press', names: ['Жим Арнольда'] },
]
