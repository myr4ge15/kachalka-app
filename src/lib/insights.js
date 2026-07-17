// ============================================================================
// Инсайты — 2–3 авто-вывода после тренировки (виш BACKLOG «✨ Инсайты»).
//
// Обычный ДВИЖОК ПРАВИЛ поверх накопленной статистики (НЕ LLM): каждое правило —
// чистая функция над денормализованными `entries`, возвращает инсайт или null.
// Движок собирает сработавшие, сортирует по важности (priority) и отдаёт верхние.
//
// Всё считается на клиенте из уже локальных данных (правило по умолчанию из
// CLAUDE.md — схему Dexie/синк не трогаем): свои тренировки, кэш ленты уже есть,
// «обгон друга» — из кэша лидерборда. Модуль чистый (без Dexie/React/сети) —
// тестируется в node; DB-обвязка (чтение + вызов движка) — в src/db/insights.js.
//
// Инсайт: { id, kind, emoji, text, tone: 'good'|'warn'|'info', priority, at }.
//   id      — стабильный (для дедупа и «прочитано» в уведомлениях);
//   at      — «якорь времени» (performed_at контекстной/последней тренировки),
//             чтобы уведомления сортировались и метка «прочитано» не сбрасывалась
//             при каждом пересчёте (now меняется — а якорь стабилен).
// ============================================================================
import { GROUP_ORDER } from './dayTags.js'
import { lastTrainedBySubmuscle } from './freshness.js'
import { labelAccusativeOf } from './muscles.js'
import { leadingValue, fmtMetricValue } from './metric.js'
import { myBestByExercise } from './records.js'
import { detectPlateau } from './progression.js'
import { currentStreak } from './profileStats.js'
import { cmpIsoDesc } from './cmp.js'
import { entryExId, entryMetric, sortDesc } from './entries.js'
import { plural } from './plural.js'

const entryName = (e) => e.name ?? e.exercise?.name ?? '—'
const groupOf = (e) => e?.muscle_group ?? e?.exercise?.muscle_group ?? null
const isBenchEntry = (e) => Boolean(e.is_bench_lift ?? e.exercise?.is_bench_lift)

// Индекс локального дня от эпохи (как в profileStats): целое число дней без
// дробей/TZ-сдвигов, день трактуется как локальный (как везде в приложении).
export function dayIndex(date) {
  const d = date instanceof Date ? date : new Date(date)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
}

// Тоннаж (Σ вес×повторы) по подходам с реальной внешней нагрузкой (weight>0).
export function workoutTonnage(w) {
  let t = 0
  for (const e of w.entries ?? []) {
    for (const s of e.sets ?? []) {
      const wt = Number(s.weight) || 0
      const reps = Number(s.reps) || 0
      if (wt > 0 && reps > 0) t += wt * reps
    }
  }
  return t
}

// Тоннаж тренировки только по одной группе мышц.
function groupTonnage(w, group) {
  let t = 0
  for (const e of w.entries ?? []) {
    if (groupOf(e) !== group) continue
    for (const s of e.sets ?? []) {
      const wt = Number(s.weight) || 0
      const reps = Number(s.reps) || 0
      if (wt > 0 && reps > 0) t += wt * reps
    }
  }
  return t
}

// Суммарный тоннаж по окну «дней назад» [to, from): from — дальняя граница
// (например 30), to — ближняя (0). Для тренда сравниваем два соседних окна.
export function tonnageInWindow(sorted, now, fromDaysAgo, toDaysAgo) {
  const today = dayIndex(now)
  let t = 0
  for (const w of sorted) {
    if (!w.performed_at) continue
    const days = today - dayIndex(new Date(w.performed_at))
    if (days >= toDaysAgo && days < fromDaysAgo) t += workoutTonnage(w)
  }
  return t
}

// Русская плюрализация (день/дня/дней, неделю/недели/недель) — общий lib/plural.js.
const plDays = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`
const plWeeks = (n) => `${n} ${plural(n, 'неделю', 'недели', 'недель')}`
const plWorkouts = (n) => plural(n, 'тренировку', 'тренировки', 'тренировок')
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

// Отсортировать по дате тренировки, свежие сверху (как getWorkouts).
// Последнее ведущее упражнение жима (is_bench_lift) в истории: id, имя, метрика.
function findBench(sorted) {
  for (const w of sorted) {
    for (const e of w.entries ?? []) {
      if (isBenchEntry(e)) {
        return { exId: entryExId(e), name: entryName(e), metric: entryMetric(e) }
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Правила. Каждое — чистая функция, возвращает инсайт или null. `anchor` — ISO
// времени-якоря для поля `at` (общих инсайтов), `ctx` — контекстная тренировка.
// ---------------------------------------------------------------------------

// R1. Новый личный рекорд, установленный контекстной тренировкой (лучший из).
function rNewPr(sorted, ctx) {
  if (!ctx) return null
  const others = myBestByExercise(sorted.filter((w) => w.id !== ctx.id))
  let top = null
  for (const e of ctx.entries ?? []) {
    const exId = entryExId(e)
    if (!exId) continue
    const m = entryMetric(e)
    const value = leadingValue(m, e.sets)
    if (value <= 0) continue
    const prev = others.get(exId)?.value ?? 0
    if (prev > 0 && value > prev) {
      // «Лучший из» рекордов выбираем по ОТНОСИТЕЛЬНОМУ приросту, а не по сырому
      // value: единицы метрик несравнимы (кг / повторы / секунды), иначе планка
      // на 120 с перебивала бы любой весовой рекорд. Тай-брейк по exId — стабильно.
      const gain = (value - prev) / prev
      const cand = { exId, name: entryName(e), metric: m, value, prev, gain }
      if (!top || gain > top.gain || (gain === top.gain && String(exId) < String(top.exId))) top = cand
    }
  }
  if (!top) return null
  return {
    id: `ins:pr:${ctx.id}:${top.exId}`,
    kind: 'pr',
    emoji: '🏆',
    tone: 'good',
    priority: 100,
    at: ctx.performed_at,
    text: `Новый рекорд: ${top.name} — ${fmtMetricValue(top.metric, top.value)} (было ${fmtMetricValue(top.metric, top.prev)})`,
  }
}

// R2. Обгон друга по жиму: новый жимовой рекорд контекстной тренировки перешагнул
// вес соперника в лидерборде, которого раньше не доставал. Нужен снимок борда.
function rOvertook(sorted, ctx, leaderboard, userId) {
  if (!ctx || !leaderboard) return null
  const others = myBestByExercise(sorted.filter((w) => w.id !== ctx.id))
  let benchExId = null
  let newV = 0
  for (const e of ctx.entries ?? []) {
    if (isBenchEntry(e)) {
      benchExId = entryExId(e)
      newV = leadingValue('weight', e.sets)
      break
    }
  }
  if (!benchExId || newV <= 0) return null
  const prevV = others.get(benchExId)?.value ?? 0
  if (prevV <= 0) return null // впервые делаем жим — это не «обгон»
  const rows = (leaderboard.male ?? []).filter((r) => r.user_id !== userId)
  const passed = rows.filter((r) => {
    const w = Number(r.weight) || 0
    // Строго ПРЕВЗОШёл: равный вес — это ничья, а не обгон (было `w <= newV`).
    return w > prevV && w < newV
  })
  if (!passed.length) return null
  const top = passed.reduce((a, b) => ((Number(b.weight) || 0) > (Number(a.weight) || 0) ? b : a))
  return {
    id: `ins:overtook:${ctx.id}:${top.user_id}`,
    kind: 'overtook',
    emoji: '🥇',
    tone: 'good',
    priority: 90,
    at: ctx.performed_at,
    text: `Обошёл ${top.user_name ?? 'друга'} по жиму!`,
  }
}

// R3. Рекордный объём по группе: контекстная тренировка — самая объёмная (Σ
// вес×повт.) на какой-то из своих групп за всю историю (побит прежний максимум).
function rBiggestSession(sorted, ctx) {
  if (!ctx) return null
  const groups = [...new Set((ctx.entries ?? []).map(groupOf).filter(Boolean))]
  let best = null
  for (const g of groups) {
    const cur = groupTonnage(ctx, g)
    if (cur <= 0) continue
    let prevMax = 0
    let seen = 0
    for (const w of sorted) {
      if (w.id === ctx.id) continue
      const t = groupTonnage(w, g)
      if (t > 0) {
        seen++
        if (t > prevMax) prevMax = t
      }
    }
    if (seen >= 1 && cur > prevMax && (!best || cur > best.cur)) best = { g, cur }
  }
  if (!best) return null
  return {
    id: `ins:vol:${ctx.id}:${best.g}`,
    kind: 'volume',
    emoji: '📈',
    tone: 'good',
    priority: 80,
    at: ctx.performed_at,
    text: `Рекордный объём на группу «${best.g}» за всё время`,
  }
}

// R4. Плато в жиме: ведущий вес не растёт 4 тренировки подряд (нет нового
// максимума в окне). Переиспользует детектор плато из progression.js.
function rPlateau(sorted, anchor) {
  const W = 4 // окно плато (сессий)
  const bench = findBench(sorted)
  if (!bench?.exId) return null
  const recent = []
  for (const w of sorted) {
    const e = (w.entries ?? []).find((x) => entryExId(x) === bench.exId)
    if (e) recent.push({ sets: e.sets ?? [] })
  }
  if (recent.length < W) return null
  if (!detectPlateau(recent, bench.metric, { window: W })) return null
  // Показываем ПОТОЛОК — лучший результат в окне, который не удаётся побить. Это
  // осознанно максимум: плато = «нет нового рекорда N тренировок». Более поздние
  // сессии с меньшим весом потолок не опускают (важно, что выше него не прыгнул).
  // Поэтому глагол «не растёт» (а не «стоит»): корректен и когда результат просел.
  const ceiling = recent
    .slice(0, W)
    .reduce((mx, s) => Math.max(mx, leadingValue(bench.metric, s.sets)), 0)
  const ceilingStr = ceiling > 0 ? ` (${fmtMetricValue(bench.metric, ceiling)})` : ''
  return {
    id: `ins:plateau:${bench.exId}`,
    kind: 'plateau',
    emoji: '🧗',
    tone: 'warn',
    priority: 65,
    at: anchor,
    text: `${bench.name}: результат${ceilingStr} не растёт ${W} ${plWorkouts(W)} — попробуй сменить схему`,
  }
}

// R5. Забытая мышца: какая-то тренированная ранее ПОДМЫШЦА (по основной работе)
// не прорабатывалась ≥ threshold дней (по самой «просроченной»). Слайс 3c: уровень
// подмышцы вместо крупной группы (кардио пропускаем).
function rGroupNeglected(sorted, now, anchor, { threshold = 8 } = {}) {
  const lastDay = lastTrainedBySubmuscle(sorted) // submuscle → {day,at}
  const today = dayIndex(now)
  let worst = null
  for (const [s, { day }] of lastDay) {
    if (s === 'cardio') continue
    const days = today - day
    // Тай-брейк по слагу подмышцы: при равной «просроченности» выбор не должен
    // зависеть от порядка обхода Map (иначе «забытая мышца» флипает между прогонами).
    if (days >= threshold && (!worst || days > worst.days || (days === worst.days && s < worst.s)))
      worst = { s, days }
  }
  if (!worst) return null
  return {
    id: `ins:neglect:${worst.s}`,
    kind: 'neglect',
    emoji: '⏰',
    tone: 'info',
    priority: 70,
    at: anchor,
    text: `${cap(labelAccusativeOf(worst.s))} не тренировал ${plDays(worst.days)} — пора`,
  }
}

// R6. Тренд тоннажа: последние `days` дней против предыдущих `days`. Порог 10%,
// чтобы не шуметь. Рост важнее (priority выше), спад — как мягкое предупреждение.
function rTonnageTrend(sorted, now, anchor, { days = 30 } = {}) {
  const cur = tonnageInWindow(sorted, now, days, 0)
  const prev = tonnageInWindow(sorted, now, 2 * days, days)
  if (prev <= 0 || cur <= 0) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (Math.abs(pct) < 10) return null
  const up = pct > 0
  return {
    id: `ins:trend:${days}`,
    kind: 'trend',
    emoji: up ? '📊' : '📉',
    tone: up ? 'good' : 'warn',
    priority: up ? 60 : 45,
    at: anchor,
    text: up
      ? `За ${days} дней тоннаж вырос на ${pct}%`
      : `За ${days} дней тоннаж снизился на ${Math.abs(pct)}%`,
  }
}

// R7. Серия недель подряд с тренировками (≥2).
function rStreak(sorted, now, anchor) {
  const n = currentStreak(sorted, now)
  if (n < 2) return null
  return {
    id: `ins:streak:${n}`,
    kind: 'streak',
    emoji: '🔥',
    tone: 'good',
    priority: 50,
    at: anchor,
    text: `${plWeeks(n)} подряд с тренировками — серия держится`,
  }
}

// ---------------------------------------------------------------------------
// Движок: собрать инсайты, дедупнуть, отсортировать по важности, отдать верхние.
//   workouts       — свои тренировки (денормализованные);
//   leaderboard    — { male, female } из кэша (для «обгона»), опционально;
//   userId         — свой id (исключить себя из борда);
//   contextWorkoutId — тренировка-контекст (после сохранения); по умолчанию свежая;
//   now            — текущее время (инъекция в тестах);
//   max            — сколько инсайтов вернуть (2–3).
// ---------------------------------------------------------------------------
export function buildInsights({
  workouts,
  leaderboard = null,
  userId = null,
  contextWorkoutId = null,
  now = new Date(),
  max = 3,
} = {}) {
  const sorted = sortDesc(workouts)
  if (!sorted.length) return []
  const anchor = sorted[0].performed_at
  const ctx = contextWorkoutId ? sorted.find((w) => w.id === contextWorkoutId) ?? null : sorted[0]

  const out = []
  const push = (x) => { if (x) out.push(x) }

  push(rNewPr(sorted, ctx))
  push(rOvertook(sorted, ctx, leaderboard, userId))
  push(rBiggestSession(sorted, ctx))
  push(rPlateau(sorted, anchor))
  push(rGroupNeglected(sorted, now, anchor))
  push(rTonnageTrend(sorted, now, anchor))
  push(rStreak(sorted, now, anchor))

  const seen = new Set()
  const uniq = out.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
  uniq.sort((a, b) => b.priority - a.priority || cmpIsoDesc(a.at, b.at))
  return uniq.slice(0, Math.max(0, max))
}

// Экспорт для тестов/переиспользования (порядок групп — уже из dayTags).
export { GROUP_ORDER }
