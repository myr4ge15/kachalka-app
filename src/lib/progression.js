// ============================================================================
// Автопрогрессия рабочих весов/повторов (PLAN-autoprogression) — чистая логика
// БЕЗ Dexie/React/сети. Надстройка над автоподстановкой прошлого подхода
// (lib/lastSets.js): вместо немой копии последней сессии предлагаем следующий
// шаг с человеческой причиной. Всё считается из уже локальных `entries`; схему
// Dexie и синк не трогаем (правило по умолчанию из CLAUDE.md).
//
// Метрика упражнения (lib/metric.js) определяет, ЧЕМ прогрессируем:
//   weight → рабочим ВЕСОМ (стратегия '+вес') либо ПОВТОРАМИ до потолка ('+повт.');
//   reps   → числом ПОВТОРОВ (своего веса), вес всегда 0;
//   time   → СЕКУНДАМИ (планка/кардио), вес всегда 0.
//
// Ветки (kind): 'up' | 'same' | 'down' | 'nudge' | 'first'
//   up    — выполнил цель прошлый раз → +шаг (зелёная);
//   same  — не добил в пределах допуска → тот же ориентир, добей план (жёлтая);
//   down  — сильно не добил → снизим, закрепимся (красная);
//   nudge — стратегия '+повт.' и N сессий подряд закрыты на одном весе → пора +вес;
//   first — упражнение впервые / нет валидной истории → панель не показываем.
//
// Дефолты мягкие (осознанный выбор, см. PLAN §8):
//   • «план повторов» = ПЕРВЫЙ рабочий подход прошлой сессии (не максимум) —
//     ниже планка, реже завышаем цель;
//   • ветка 'down' только когда СИЛЬНО недобрано на ≥2 подходах (реже снижаем).
// ============================================================================

import { normMetric, isCountMetric, leadingValue } from './metric.js'

// Дефолтные значения стратегии по метрике. Шаг: 2.5 кг (вес), +1 повтор, +5 сек.
const DEFAULTS = {
  weight: { strategy: 'weight', step: 2.5, targetReps: null, repCeiling: 12 },
  reps: { strategy: 'reps', step: 1, targetReps: null, repCeiling: null },
  time: { strategy: 'reps', step: 5, targetReps: null, repCeiling: null },
}
const STRATEGIES = ['weight', 'reps', 'manual', 'off']

// Ветка 'down' срабатывает при СИЛЬНОМ недоборе минимум на стольких подходах.
const MIN_BIG_SHORT_SETS = 2
// Насколько крупный недобор считаем «сильным» — по метрике (секунды крупнее).
function bigShortfall(metric) {
  return normMetric(metric) === 'time' ? 10 : 3
}
const EASY_STREAK_NEEDED = 3 // сколько сессий подряд «легко» → нудж к +весу

// Нормализация веса к шагу приложения (2 знака, как trim_scale/clampWeight).
const roundW = (v) => Math.round((Number(v) || 0) * 100) / 100
// Печать шага без хвостовых нулей: 2.5 → «2.5», 2 → «2».
const fmtStep = (v) => String(Math.round((Number(v) || 0) * 100) / 100)
// База повторов после накидывания веса в стратегии '+повт.' (схема 8–12 → 8).
const repFloor = (ceiling) => Math.max(1, Math.round(Number(ceiling) || 12) - 4)

// Привести произвольный подход к числам {weight, reps}. reps ≤ 0 отбрасывается
// вызывающим (пустой подход не участвует в анализе).
function numSet(s) {
  return { weight: Number(s?.weight) || 0, reps: Number(s?.reps) || 0 }
}

// Эффективные настройки прогрессии для упражнения: дефолты по метрике,
// перекрытые пер-упражненческим override из meta (prog.byExercise[exId]).
// Count-метрики не умеют '+вес' → стратегия 'weight' приводится к 'reps'.
export function resolveProgSettings(prog, exId, metric) {
  const m = normMetric(metric)
  const base = DEFAULTS[m] ?? DEFAULTS.weight
  const ov = prog?.byExercise?.[exId] ?? {}
  const out = {
    strategy: STRATEGIES.includes(ov.strategy) ? ov.strategy : base.strategy,
    step: Number(ov.step) > 0 ? Number(ov.step) : base.step,
    targetReps: Number(ov.targetReps) > 0 ? Math.round(Number(ov.targetReps)) : null,
    repCeiling: Number(ov.repCeiling) > 0 ? Math.round(Number(ov.repCeiling)) : base.repCeiling,
  }
  if (m !== 'weight' && out.strategy === 'weight') out.strategy = 'reps'
  return out
}

// Разбор прошлой сессии одного упражнения. Возвращает рабочий вес (макс. вес
// среди подходов; у count-метрик 0), плановые повторы (override или первый
// рабочий подход), худший недобор и число сильно-недоборных подходов, флаг
// «всё выполнено». null, если валидных подходов нет.
export function analyzeLast(lastSets, settings = {}, metric = 'weight') {
  const m = normMetric(metric)
  const sets = (lastSets ?? []).map(numSet).filter((s) => s.reps > 0)
  if (!sets.length) return null

  const count = isCountMetric(m)
  // Рабочий вес — максимальный вес сессии; «рабочие подходы» — те, что на нём.
  // У count-метрик веса нет: рабочие подходы = все подходы, значение = reps.
  const workWeight = count ? 0 : sets.reduce((mx, s) => Math.max(mx, s.weight), 0)
  const working = count ? sets : sets.filter((s) => s.weight === workWeight)

  // Ведущее значение подхода: у weight — повторы на рабочем весе, у count — reps.
  const values = working.map((s) => s.reps)
  const targetReps = settings.targetReps ?? values[0] ?? 0
  const shortfalls = values.map((v) => Math.max(0, targetReps - v))
  const worstShortfall = shortfalls.reduce((mx, v) => Math.max(mx, v), 0)
  const bigShortCount = shortfalls.filter((v) => v >= bigShortfall(m)).length

  return {
    metric: m,
    workWeight,
    targetReps,
    worstShortfall,
    bigShortCount,
    workingCount: working.length,
    allDone: worstShortfall === 0,
  }
}

// Сколько последних сессий ПОДРЯД (с самой свежей) закрыты «легко»: все рабочие
// подходы добиты до плана И на ОДНОМ рабочем весе (для weight-метрики). Первый же
// недобор или смена рабочего веса обрывают серию. Для count-метрик вес не сверяем.
// recentSessions — новейшие сверху, элемент: { sets:[{weight,reps}] } или сам массив.
export function easyStreak(recentSessions, settings = {}, metric = 'weight') {
  const m = normMetric(metric)
  let streak = 0
  let refWeight = null
  for (const sess of recentSessions ?? []) {
    const sets = Array.isArray(sess) ? sess : sess?.sets
    const a = analyzeLast(sets, settings, m)
    if (!a || !a.allDone) break
    if (m === 'weight') {
      if (refWeight === null) refWeight = a.workWeight
      else if (a.workWeight !== refWeight) break
    }
    streak++
  }
  return streak
}

// Плато: ведущий показатель (макс. вес / макс. повторы / макс. секунды) не вырос
// за последние `window` сессий — в окне нет нового максимума. Нужно ≥ window
// сессий, иначе false (рано судить). Переиспользуемо в «Инсайтах».
export function detectPlateau(recentSessions, metric = 'weight', { window = 4 } = {}) {
  const m = normMetric(metric)
  const vals = (recentSessions ?? []).slice(0, window).map((sess) => {
    const sets = Array.isArray(sess) ? sess : sess?.sets
    return leadingValue(m, sets ?? [])
  })
  if (vals.length < window) return false
  const newest = vals[0]
  const restMax = Math.max(...vals.slice(1))
  return newest <= restMax
}

// Собрать результат: пометить, отличается ли рекомендация от простой копии
// прошлой сессии (для UI: показывать ли «Применить» и что вообще изменилось).
function sameSets(a, b) {
  if (a.length !== b.length) return false
  return a.every((s, i) => s.weight === b[i].weight && s.reps === b[i].reps)
}
function result(kind, sets, reasonText, prev) {
  return { kind, sets, reasonText, changed: !sameSets(sets, prev) }
}

// Рекомендация на сегодня по прошлой сессии + настройкам.
//   { metric, lastSets:[{weight,reps}], recentSessions:[{performed_at,sets}], settings }
// → { kind, sets:[{weight,reps}], reasonText, changed }.
// Для count-метрик у подходов weight:0. settings — уже эффективные
// (resolveProgSettings). Нет истории → kind:'first' (панель прячем, вызывающий
// подставляет дефолт); стратегия 'manual'/'off' → копия прошлого без панели.
export function recommendProgression({ metric, lastSets, recentSessions, settings } = {}) {
  const m = normMetric(metric)
  const cfg = settings ?? resolveProgSettings(null, null, m)
  const prev = (lastSets ?? []).map(numSet)

  if (!prev.length) return { kind: 'first', sets: null, reasonText: '', changed: false }
  if (cfg.strategy === 'off' || cfg.strategy === 'manual') {
    return { kind: cfg.strategy, sets: prev, reasonText: '', changed: false }
  }

  const a = analyzeLast(prev, cfg, m)
  if (!a) return { kind: 'first', sets: null, reasonText: '', changed: false }

  const step = Number(cfg.step) > 0 ? Number(cfg.step) : DEFAULTS[m].step
  const R = a.targetReps
  const down = a.bigShortCount >= MIN_BIG_SHORT_SETS

  // Строим рекомендованные подходы: рабочие подходы получают новый вес/повторы,
  // остальные (разминочные, на меньшем весе) остаются как были.
  const buildWeightSets = (newWeight, newReps) =>
    prev.map((s) =>
      s.weight === a.workWeight ? { weight: roundW(newWeight), reps: newReps } : { weight: s.weight, reps: s.reps }
    )
  const buildCountSets = (val) => prev.map(() => ({ weight: 0, reps: Math.max(1, val) }))

  // ---- Весовые упражнения, стратегия '+вес' -------------------------------
  if (m === 'weight' && cfg.strategy === 'weight') {
    if (a.allDone) {
      return result('up', buildWeightSets(a.workWeight + step, R), `Всё выполнено → +${fmtStep(step)} кг`, prev)
    }
    if (down) {
      const dw = roundW(a.workWeight - step)
      const newWeight = dw > 0 ? dw : a.workWeight // не уводим вес ≤ 0
      const text = newWeight < a.workWeight
        ? `Тяжело далось → −${fmtStep(step)} кг, закрепимся`
        : `Тяжело далось → тот же вес, закрепимся`
      return result('down', buildWeightSets(newWeight, R), text, prev)
    }
    return result('same', buildWeightSets(a.workWeight, R), `Не добил повторы → тот же вес, добей ${a.workingCount}×${R}`, prev)
  }

  // ---- Весовые упражнения, стратегия '+повторы' ---------------------------
  if (m === 'weight' && cfg.strategy === 'reps') {
    const ceiling = Number(cfg.repCeiling) > 0 ? Math.round(cfg.repCeiling) : 12
    const streak = easyStreak(recentSessions ?? [{ sets: prev }], cfg, m)
    if (a.allDone && streak >= EASY_STREAK_NEEDED) {
      return result('nudge', buildWeightSets(a.workWeight + step, repFloor(ceiling)),
        `${streak} тренировки подряд закрываешь → пора +${fmtStep(step)} кг`, prev)
    }
    if (a.allDone) {
      if (R >= ceiling) {
        return result('up', buildWeightSets(a.workWeight + step, repFloor(ceiling)),
          `Потолок ${ceiling} повт. → +${fmtStep(step)} кг`, prev)
      }
      return result('up', buildWeightSets(a.workWeight, R + 1), 'Всё выполнено → +1 повтор', prev)
    }
    if (down) {
      return result('down', buildWeightSets(a.workWeight, Math.max(1, R - 1)), 'Тяжело далось → меньше повторов, закрепимся', prev)
    }
    return result('same', buildWeightSets(a.workWeight, R), `Не добил → тот же вес, добей ${a.workingCount}×${R}`, prev)
  }

  // ---- Count-метрики (повторы / время): прогрессия по ведущему значению ----
  const unit = m === 'time' ? 'с' : 'повт.'
  if (a.allDone) {
    return result('up', buildCountSets(R + step), `Всё выполнено → +${fmtStep(step)} ${unit}`, prev)
  }
  if (down) {
    return result('down', buildCountSets(Math.max(1, R - step)), 'Тяжело далось → снизим, закрепимся', prev)
  }
  return result('same', buildCountSets(R), `Не добил → тот же ориентир, добей ${R}`, prev)
}
