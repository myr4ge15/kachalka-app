// ============================================================================
// Таксономия мышц — двухуровневая модель (виш BACKLOG «Детализация групп мышц»,
// PLAN-muscle-detail, слайс 1). Над существующим уровнем КРУПНЫХ групп (7
// канонических из lib/dayTags.js `GROUP_ORDER`) вводится лист «подмышца»
// (submuscle) + понятие ВТОРИЧНЫХ мышц упражнения.
//
// Здесь — только СПРАВОЧНИК (таксономия) и чистые хелперы над ним. Никакой
// Dexie/React/сети. Модуль НАМЕРЕННО самодостаточный (не импортит dayTags/
// freshness) — чтобы freshness.js мог импортить ЕГО в слайсе 3 без цикла.
//
// Слайс 1 не меняет поведение движков/UI: `submuscle` тянется в `entries` и
// хранится в справочнике, но потребители (dayTags/freshness/MuscleMap) пока
// работают на уровне major с фолбэком. Точная свежесть/heatmap на подмышцах —
// слайс 3.
//
// Соглашения:
//  • слаг подмышцы — латиницей (для CSS-классов/серверных значений);
//  • `major` каждой подмышцы ∈ GROUP_ORDER (сверяется тестом);
//  • пороги восстановления (`recoveryHours`) — эвристики «для зала любителей»,
//    не медицина (см. PLAN §7); крупные мышцы дольше, мелкие быстрее.
// ============================================================================

// Понижающий коэффициент нагрузки ВТОРИЧНОЙ мышцы относительно основной: вторичная
// работа учитывается в объеме/дисбалансе, но с этим весом, и НЕ обнуляет таймер
// восстановления как основная (PLAN §2.5). Точную формулу свежести дожимаем в
// слайсе 3; здесь фиксируем константу как единый источник правды.
export const SECONDARY_LOAD_FACTOR = 0.5

// Справочник подмышц: слаг → { major, label, labelAccusative, recoveryHours }.
// Порядок ключей = порядок предложения внутри группы в пикере (слайс 2).
// NB: набор крупных групп сверен с РЕАЛЬНОЙ базой (select из exercises, 13.07):
// помимо 7 канонических там как отдельные major живут «ягодицы» (ядро женской
// программы — много упражнений) и «трапеции». Поэтому они здесь — полноценные
// группы со своими подмышцами (ягодичные делим на большую/среднюю — самый
// ценный сплит для этой программы). Порядок ключей = порядок в пикере.
export const SUBMUSCLES = {
  // грудь
  chest_upper:  { major: 'грудь',    label: 'верх груди',         labelAccusative: 'верх груди',         recoveryHours: 48 },
  chest_middle: { major: 'грудь',    label: 'середина груди',     labelAccusative: 'середину груди',     recoveryHours: 48 },
  chest_lower:  { major: 'грудь',    label: 'низ груди',          labelAccusative: 'низ груди',          recoveryHours: 48 },
  serratus:     { major: 'грудь',    label: 'зубчатая',           labelAccusative: 'зубчатую',           recoveryHours: 48, minor: true },
  // спина
  lats:         { major: 'спина',    label: 'широчайшие',         labelAccusative: 'широчайшие',         recoveryHours: 72 },
  rhomboids:    { major: 'спина',    label: 'ромбовидные',        labelAccusative: 'ромбовидные',        recoveryHours: 48 },
  lower_back:   { major: 'спина',    label: 'разгибатели спины',  labelAccusative: 'разгибатели спины',  recoveryHours: 72 },
  // трапеции (в реальной базе — отдельная группа). v8.2.0: верх (шраги) и
  // середина+низ (YTWL, тяга к лицу) — разная работа; слаг `traps` остался за верхом,
  // чтобы старая разметка и история не переезжали.
  traps:        { major: 'трапеции', label: 'верх трапеции',      labelAccusative: 'верх трапеции',      recoveryHours: 48 },
  traps_lower:  { major: 'трапеции', label: 'середина и низ трапеции', labelAccusative: 'середину и низ трапеции', recoveryHours: 48 },
  // ноги
  quads:        { major: 'ноги',     label: 'квадрицепс',         labelAccusative: 'квадрицепс',         recoveryHours: 72 },
  hamstrings:   { major: 'ноги',     label: 'бицепс бедра',       labelAccusative: 'бицепс бедра',       recoveryHours: 72 },
  calves:       { major: 'ноги',     label: 'икры',               labelAccusative: 'икры',               recoveryHours: 48 },
  adductors:    { major: 'ноги',     label: 'приводящие',         labelAccusative: 'приводящие',         recoveryHours: 48 },
  // ягодицы (в реальной базе — отдельная группа; делим на большую/среднюю)
  glute_max:    { major: 'ягодицы',  label: 'большая ягодичная',  labelAccusative: 'большую ягодичную',  recoveryHours: 72 },
  glute_med:    { major: 'ягодицы',  label: 'средняя ягодичная',  labelAccusative: 'среднюю ягодичную',  recoveryHours: 48 },
  // плечи
  delt_front:   { major: 'плечи',    label: 'передняя дельта',    labelAccusative: 'переднюю дельту',    recoveryHours: 48 },
  delt_side:    { major: 'плечи',    label: 'средняя дельта',     labelAccusative: 'среднюю дельту',     recoveryHours: 48 },
  delt_rear:    { major: 'плечи',    label: 'задняя дельта',      labelAccusative: 'заднюю дельту',      recoveryHours: 48 },
  // v8.2.0: мышцы-вращатели плеча (наружная ротация, тяга к лицу) — профилактика плеча.
  rotator_cuff: { major: 'плечи',    label: 'вращательная манжета', labelAccusative: 'вращательную манжету', recoveryHours: 48 },
  // бицепс
  biceps:       { major: 'бицепс',   label: 'бицепс',             labelAccusative: 'бицепс',             recoveryHours: 48 },
  // предплечья — отдельная группа с v8.2.0 (раньше жили внутри бицепса): хват,
  // кисти, вис. Слаг тот же — разметка «вторичные: forearms» не меняется.
  forearms:     { major: 'предплечья', label: 'предплечья',       labelAccusative: 'предплечья',         recoveryHours: 48 },
  // трицепс
  triceps:      { major: 'трицепс',  label: 'трицепс',            labelAccusative: 'трицепс',            recoveryHours: 48 },
  // пресс
  abs_rectus:   { major: 'пресс',    label: 'пресс',              labelAccusative: 'пресс',              recoveryHours: 24 },
  abs_obliques: { major: 'пресс',    label: 'косые',              labelAccusative: 'косые',              recoveryHours: 24 },
  hip_flexors:  { major: 'пресс',    label: 'сгибатели бедра',    labelAccusative: 'сгибатели бедра',    recoveryHours: 24 },
  // кор — глубокие стабилизаторы (планка/анти-ротация/статика): отдельная подмышца
  // от динамики прямой мышцы (пресс). Порог чуть выше «пресса» — изометрия под
  // нагрузкой утомляет глубокие стабилизаторы дольше кранчей (эвристика, не медицина).
  core:         { major: 'пресс',    label: 'кор',                labelAccusative: 'кор',                recoveryHours: 48 },
  // кардио
  cardio:       { major: 'кардио',   label: 'кардио',             labelAccusative: 'кардио',             recoveryHours: 24 },
  // разминка (v8.2.0) — как кардио, НЕ мышца: разминка и мобилизация не должны
  // «тренировать» плечи и ягодицы в восстановлении и подсказке «что сегодня».
  warmup:       { major: 'разминка', label: 'разминка',           labelAccusative: 'разминку',           recoveryHours: 24 },
}

// Подмышцы-«не мышцы» (v8.2.0): кардио и разминка. В восстановление, дисбаланс,
// «забытую мышцу» и вторичные не входят. Единая проверка вместо `s === 'cardio'`.
const NON_MUSCLE_SUBS = new Set(['cardio', 'warmup'])
export function isNonMuscleSub(sub) {
  return NON_MUSCLE_SUBS.has(sub)
}

// Те же «не мышцы» на уровне крупной группы (свежесть групп, фильтры).
export const WARMUP_GROUP = 'разминка'
export const NON_MUSCLE_GROUPS = ['кардио', WARMUP_GROUP]
export function isNonMuscleGroup(group) {
  return NON_MUSCLE_GROUPS.includes(group)
}

// Дефолтная подмышца КРУПНОЙ группы — для бэкфилла истории и старта своих
// упражнений (major → слаг). Все значения обязаны быть ключами SUBMUSCLES.
export const MAJOR_DEFAULT_SUB = {
  'грудь':    'chest_middle',
  'спина':    'lats',
  'трапеции': 'traps',
  'ноги':     'quads',
  'ягодицы':  'glute_max',
  'плечи':    'delt_side',
  'бицепс':   'biceps',
  'предплечья': 'forearms',
  'трицепс':  'triceps',
  'пресс':    'abs_rectus',
  'кардио':   'cardio',
  'разминка': 'warmup',
}

export const DEFAULT_SUB_RECOVERY_HOURS = 48

// Все слаги подмышц в порядке объявления (группы идут блоками — как в SUBMUSCLES).
export const SUBMUSCLE_SLUGS = Object.keys(SUBMUSCLES)

// Известен ли слаг подмышцы.
export function isKnownSub(sub) {
  return typeof sub === 'string' && Object.prototype.hasOwnProperty.call(SUBMUSCLES, sub)
}

// «Минорная» подмышца (`minor: true`) — стабилизатор/мелкая мышца, которую НИ ОДНО
// упражнение не грузит как ОСНОВНУЮ (только вторично, напр. зубчатая на пуловере).
// Такие исключаются из дисбаланса свежести: иначе движок вечно нагибал бы «давно не
// тренировал <минорную>» внутри активной группы, хотя ее и невозможно сделать целевой.
export function isMinorSub(sub) {
  return isKnownSub(sub) && SUBMUSCLES[sub].minor === true
}

// Крупная группа подмышцы (major) | null для неизвестного слага.
export function majorOf(sub) {
  return isKnownSub(sub) ? SUBMUSCLES[sub].major : null
}

// Список слагов подмышц данной крупной группы (в порядке объявления).
export function submusclesOf(major) {
  const out = []
  for (const [slug, def] of Object.entries(SUBMUSCLES)) if (def.major === major) out.push(slug)
  return out
}

// Дефолтная подмышца группы | null, если группа неизвестна.
export function defaultSubmuscleFor(major) {
  return MAJOR_DEFAULT_SUB[major] ?? null
}

// Порог восстановления (часы) подмышцы; неизвестный слаг → общий дефолт.
export function recoveryHoursFor(sub) {
  const h = isKnownSub(sub) ? SUBMUSCLES[sub].recoveryHours : 0
  return h > 0 ? h : DEFAULT_SUB_RECOVERY_HOURS
}

// Подпись подмышцы (именительный) | сам слаг, если неизвестен.
export function labelOf(sub) {
  return isKnownSub(sub) ? SUBMUSCLES[sub].label : sub
}

// Подпись подмышцы в винительном (для фраз «тренировать <что>»).
export function labelAccusativeOf(sub) {
  return isKnownSub(sub) ? SUBMUSCLES[sub].labelAccusative : sub
}

// Кандидаты во ВТОРИЧНЫЕ мышцы для пикера/админки: все подмышцы, кроме самой
// основной (primary) и «не мышц» (кардио и разминка — не вторичная нагрузка силовых).
// Порядок — как в SUBMUSCLE_SLUGS (блоками по группам).
export function secondaryOptionsFor(primarySlug) {
  return SUBMUSCLE_SLUGS.filter((s) => s !== primarySlug && !isNonMuscleSub(s))
}

// Санитайз списка вторичных: только известные слаги, без дублей, без основной и
// без «не мышц» (кардио, разминка). Возвращает массив в каноническом порядке SUBMUSCLE_SLUGS.
export function cleanSecondary(secondary, primarySlug) {
  const set = new Set((secondary ?? []).filter(isKnownSub))
  set.delete(primarySlug)
  for (const s of NON_MUSCLE_SUBS) set.delete(s)
  return SUBMUSCLE_SLUGS.filter((s) => set.has(s))
}
