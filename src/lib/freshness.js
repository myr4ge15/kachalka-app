// ============================================================================
// Свежесть по группам мышц — единый чистый движок (виш BACKLOG «Свежесть по
// группам мышц — recovery / дисбаланс / heatmap»). Одно окно данных: последняя
// дата тренировки по каждой `muscle_group` из денормализованных `entries`
// (та же карта групп, что в lib/dayTags.js). Поверх неё — три представления:
//   • recovery  — когда снова тренировать группу (порог по часам, свой на группу);
//   • дисбаланс — канонические группы, выпавшие из окна (never/stale);
//   • heatmap   — бакет цвета давности для раскраски силуэта (см. слайс UI).
//
// Модуль ЧИСТЫЙ (без Dexie/React/сети) — тестируется в node. Ничего в схеме/синке
// не трогаем (правило по умолчанию из CLAUDE.md): всё из уже локальных `entries`.
//
// NB (без циклов импорта): движок НЕ импортит insights.js/homeSummary.js — они,
// наоборот, зависят от него (переехали на `lastTrainedByGroup`). Поэтому `dayIndex`
// и `groupOf` здесь — свои маленькие копии (паритет с insights.js), а не импорт.
// ============================================================================
import { GROUP_ORDER } from './dayTags.js'
import {
  recoveryHoursFor as subRecoveryHoursFor,
  majorOf,
  defaultSubmuscleFor,
  SUBMUSCLE_SLUGS,
} from './muscles.js'

// Пороги восстановления (часы) по группам: крупные группы восстанавливаются
// дольше, мелкие — быстрее. Значения — разумные дефолты «для зала любителей»,
// не медицинская истина; служат порогом «можно снова / дай отдых».
export const GROUP_RECOVERY_HOURS = {
  'ноги': 72,
  'спина': 72,
  'грудь': 48,
  'плечи': 48,
  'бицепс': 48,
  'трицепс': 48,
  'пресс': 24,
}
export const DEFAULT_RECOVERY_HOURS = 48

export function recoveryHoursFor(group) {
  const h = GROUP_RECOVERY_HOURS[group]
  return h > 0 ? h : DEFAULT_RECOVERY_HOURS
}

// Индекс локального дня от эпохи (паритет с insights.js dayIndex): целое число
// дней без дробей/TZ-сдвигов, день трактуется как локальный.
export function dayIndex(date) {
  const d = date instanceof Date ? date : new Date(date)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
}

// Группа мышц из записи (оба формата: repo — exercise.muscle_group, feed —
// muscle_group). Паритет с dayTags.groupOf.
const groupOf = (e) => e?.muscle_group ?? e?.exercise?.muscle_group ?? null

// Карта «последняя тренировка по группе»: group → { day, at, t }, где day —
// индекс дня, at — ISO самой свежей тренировки этой группы, t — её timestamp (мс,
// для выбора самой свежей внутри дня). Пропускаем удалённые и без даты.
export function lastTrainedByGroup(workouts) {
  const map = new Map()
  for (const w of workouts ?? []) {
    if (!w || w._deleted || !w.performed_at) continue
    const t = new Date(w.performed_at).getTime()
    if (Number.isNaN(t)) continue
    const day = dayIndex(new Date(w.performed_at))
    for (const g of new Set((w.entries ?? []).map(groupOf).filter(Boolean))) {
      const cur = map.get(g)
      if (!cur || t > cur.t) map.set(g, { day, at: w.performed_at, t })
    }
  }
  return map
}

// Состояние восстановления по прошедшим часам и порогу группы:
//   'resting' — дай отдых (< 0.75 порога),
//   'almost'  — почти готова (0.75..1 порога),
//   'ready'   — можно снова (≥ порога).
export function freshnessState(hoursSince, recoveryHours) {
  const r = recoveryHours > 0 ? recoveryHours : DEFAULT_RECOVERY_HOURS
  if (hoursSince >= r) return 'ready'
  if (hoursSince >= r * 0.75) return 'almost'
  return 'resting'
}

// Бакет ЦВЕТА по давности (дней), независимо от порога восстановления — для
// heatmap-силуэта. 0–2 fresh (красный «отдыхает») · 3–6 recent (оранжевый) ·
// 7–14 due (бирюзовый «пора») · >14 overdue (синий «давно»). «never» — отдельно
// (нет данных), см. groupFreshness/imbalance.
export function freshnessBucket(daysSince) {
  if (daysSince <= 2) return 'fresh'
  if (daysSince <= 6) return 'recent'
  if (daysSince <= 14) return 'due'
  return 'overdue'
}

// Приоритет «пора тренировать» для сортировки recovery-списка: чем группа
// свежее — тем ниже. overdue > due > recent > fresh.
const BUCKET_RANK = { overdue: 4, due: 3, recent: 2, fresh: 1, never: 0 }

// Свежесть тренированных групп: массив
//   { group, at, daysSince, hoursSince, recoveryHours, state, bucket }
// отсортированный «кого пора тренировать» вниз к «свежим». Группы без истории
// не попадают (их место — в дисбалансе как never).
export function groupFreshness(workouts, { now = new Date() } = {}) {
  const map = lastTrainedByGroup(workouts)
  const today = dayIndex(now)
  const nowT = (now instanceof Date ? now : new Date(now)).getTime()
  const out = []
  for (const [g, { day, at, t }] of map) {
    const daysSince = today - day
    const hoursSince = Math.max(0, (nowT - t) / 3600000)
    const recoveryHours = recoveryHoursFor(g)
    out.push({
      group: g,
      at,
      daysSince,
      hoursSince,
      recoveryHours,
      state: freshnessState(hoursSince, recoveryHours),
      bucket: freshnessBucket(daysSince),
    })
  }
  out.sort(
    (a, b) =>
      BUCKET_RANK[b.bucket] - BUCKET_RANK[a.bucket] ||
      b.daysSince - a.daysSince ||
      a.group.localeCompare(b.group, 'ru'),
  )
  return out
}

// Самая «просроченная» группа (дольше всего не тренировали) — { group, daysAgo }
// | null. Переиспользуется в homeSummary/insights («забытая группа»).
export function mostNeglectedGroup(workouts, now = new Date()) {
  const map = lastTrainedByGroup(workouts)
  const today = dayIndex(now)
  let worst = null
  for (const [g, { day }] of map) {
    const days = today - day
    if (!worst || days > worst.daysAgo) worst = { group: g, daysAgo: days }
  }
  return worst
}

// Анализ дисбаланса по каноническим группам (GROUP_ORDER): группа, ни разу не
// тренированная → { kind:'never', daysSince:null }; тренированная, но выпавшая
// из окна ≥ windowDays → { kind:'stale', daysSince }. Свежие группы не попадают.
// Сортировка: сначала stale (по давности вниз), затем never.
export function imbalance(workouts, { now = new Date(), windowDays = 14, groups = GROUP_ORDER } = {}) {
  const map = lastTrainedByGroup(workouts)
  const today = dayIndex(now)
  const out = []
  for (const g of groups) {
    const cur = map.get(g)
    if (!cur) {
      out.push({ group: g, kind: 'never', daysSince: null })
      continue
    }
    const daysSince = today - cur.day
    if (daysSince >= windowDays) out.push({ group: g, kind: 'stale', daysSince })
  }
  out.sort((a, b) => {
    const ra = a.kind === 'stale' ? 0 : 1
    const rb = b.kind === 'stale' ? 0 : 1
    if (ra !== rb) return ra - rb
    return (b.daysSince ?? 0) - (a.daysSince ?? 0)
  })
  return out
}

// Карта group → bucket для heatmap-силуэта: тренированные группы берут бакет
// цвета из recovery-списка, канонические «ни разу» из дисбаланса → 'never'.
// Группы без данных в карту не попадают (силуэт красит их нейтрально).
export function groupBuckets(recovery, imbalance) {
  const map = {}
  for (const f of recovery ?? []) if (f?.group) map[f.group] = f.bucket
  for (const x of imbalance ?? []) if (x?.kind === 'never' && x.group) map[x.group] = 'never'
  return map
}

// ============================================================================
// Уровень ПОДМЫШЦ (PLAN-muscle-detail, слайс 3a). Над major-движком выше — тот же
// расчёт, но по листу-подмышце (submuscle). Модель вторичных (PLAN §2.5):
//   • ОСНОВНАЯ работа (primary submuscle) обнуляет таймер восстановления и красит
//     heatmap — это lastTrainedBySubmuscle;
//   • ВТОРИЧНАЯ работа (secondary[]) — «лёгкое касание»: НЕ сбрасывает отдых, но
//     удерживает мышцу от ярлыка «заброшена» (учитывается в дисбалансе как факт
//     нагрузки) — это lastWorkedBySubmuscle. Дисконт `SECONDARY_LOAD_FACTOR`
//     (muscles.js) зарезервирован под аналитику объёма.
// Фолбэк: у записи без submuscle берём дефолт подмышцы её major (совместимость).
// ============================================================================

// Основная подмышца записи (primary) с фолбэком на дефолт major.
const subOf = (e) => {
  const s = e?.submuscle ?? e?.exercise?.submuscle ?? null
  return s || defaultSubmuscleFor(groupOf(e))
}
// Вторичные подмышцы записи (массив слагов).
const secOf = (e) => {
  const s = e?.secondary ?? e?.exercise?.secondary ?? null
  return Array.isArray(s) ? s : []
}

// Карта «последняя тренировка ПОДМЫШЦЫ как ОСНОВНОЙ» → submuscle → {day,at,t}.
// Драйвер recovery/heatmap (вторичную нагрузку сюда не считаем — §2.5).
export function lastTrainedBySubmuscle(workouts) {
  const map = new Map()
  for (const w of workouts ?? []) {
    if (!w || w._deleted || !w.performed_at) continue
    const t = new Date(w.performed_at).getTime()
    if (Number.isNaN(t)) continue
    const day = dayIndex(new Date(w.performed_at))
    for (const s of new Set((w.entries ?? []).map(subOf).filter(Boolean))) {
      const cur = map.get(s)
      if (!cur || t > cur.t) map.set(s, { day, at: w.performed_at, t })
    }
  }
  return map
}

// Карта «последняя нагрузка ПОДМЫШЦЫ» — ОСНОВНАЯ ИЛИ вторичная → submuscle →
// {day,at,t}. Для дисбаланса: мышца, работавшая вторично, не считается «ни разу».
export function lastWorkedBySubmuscle(workouts) {
  const map = new Map()
  for (const w of workouts ?? []) {
    if (!w || w._deleted || !w.performed_at) continue
    const t = new Date(w.performed_at).getTime()
    if (Number.isNaN(t)) continue
    const day = dayIndex(new Date(w.performed_at))
    const subs = new Set()
    for (const e of w.entries ?? []) {
      const p = subOf(e)
      if (p) subs.add(p)
      for (const s of secOf(e)) subs.add(s)
    }
    for (const s of subs) {
      const cur = map.get(s)
      if (!cur || t > cur.t) map.set(s, { day, at: w.performed_at, t })
    }
  }
  return map
}

// Свежесть по ПОДМЫШЦАМ (recovery-список детального экрана). По основной работе.
// Кардио исключаем (не мышца). Строки: {submuscle, major, at, daysSince,
// hoursSince, recoveryHours, state, bucket}, сортировка «пора тренировать» вниз.
export function submuscleFreshness(workouts, { now = new Date() } = {}) {
  const map = lastTrainedBySubmuscle(workouts)
  const today = dayIndex(now)
  const nowT = (now instanceof Date ? now : new Date(now)).getTime()
  const out = []
  for (const [s, { day, at, t }] of map) {
    if (s === 'cardio') continue
    const daysSince = today - day
    const hoursSince = Math.max(0, (nowT - t) / 3600000)
    const recoveryHours = subRecoveryHoursFor(s)
    out.push({
      submuscle: s,
      major: majorOf(s),
      at,
      daysSince,
      hoursSince,
      recoveryHours,
      state: freshnessState(hoursSince, recoveryHours),
      bucket: freshnessBucket(daysSince),
    })
  }
  out.sort(
    (a, b) =>
      BUCKET_RANK[b.bucket] - BUCKET_RANK[a.bucket] ||
      b.daysSince - a.daysSince ||
      a.submuscle.localeCompare(b.submuscle),
  )
  return out
}

// Внутригрупповой дисбаланс по ПОДМЫШЦАМ: только внутри АКТИВНЫХ групп (major,
// где хоть одна подмышца тренировалась как основная) — чтобы не пилить за мышцы
// групп, которые пользователь вообще не делает. never — подмышца ни разу (даже
// вторично); stale — последняя нагрузка (осн./вторичн.) старше windowDays.
export function submuscleImbalance(workouts, { now = new Date(), windowDays = 14 } = {}) {
  const worked = lastWorkedBySubmuscle(workouts)
  const trained = lastTrainedBySubmuscle(workouts)
  const activeMajors = new Set()
  for (const s of trained.keys()) if (s !== 'cardio') activeMajors.add(majorOf(s))
  const today = dayIndex(now)
  const out = []
  for (const s of SUBMUSCLE_SLUGS) {
    if (s === 'cardio') continue
    const major = majorOf(s)
    if (!activeMajors.has(major)) continue
    const w = worked.get(s)
    if (!w) {
      out.push({ submuscle: s, major, kind: 'never', daysSince: null })
      continue
    }
    const daysSince = today - w.day
    if (daysSince >= windowDays) out.push({ submuscle: s, major, kind: 'stale', daysSince })
  }
  out.sort((a, b) => {
    const ra = a.kind === 'stale' ? 0 : 1
    const rb = b.kind === 'stale' ? 0 : 1
    if (ra !== rb) return ra - rb
    return (b.daysSince ?? 0) - (a.daysSince ?? 0)
  })
  return out
}

// Карта submuscle → bucket для heatmap-силуэта по подмышцам (слайс 3b): аналог
// groupBuckets. Тренированные подмышцы берут бакет из recovery-списка, «ни разу»
// из дисбаланса → 'never'. Не тренированные в карту не идут (силуэт красит их нейтрально).
export function submuscleBuckets(recovery, imbalance) {
  const map = {}
  for (const f of recovery ?? []) if (f?.submuscle) map[f.submuscle] = f.bucket
  for (const x of imbalance ?? []) if (x?.kind === 'never' && x.submuscle) map[x.submuscle] = 'never'
  return map
}

// Самая просроченная ПОДМЫШЦА (по основной работе) → {submuscle, major, daysAgo} | null.
export function mostNeglectedSubmuscle(workouts, now = new Date()) {
  const map = lastTrainedBySubmuscle(workouts)
  const today = dayIndex(now)
  let worst = null
  for (const [s, { day }] of map) {
    if (s === 'cardio') continue
    const days = today - day
    if (!worst || days > worst.daysAgo) worst = { submuscle: s, major: majorOf(s), daysAgo: days }
  }
  return worst
}

export { GROUP_ORDER }
