// Оркестрация рекомендации автопрогрессии (PLAN-autoprogression) для карточки
// упражнения в WorkoutScreen + чистые форматтеры панели. Без React/Dexie/сети —
// покрыто progressionCard.test.js. Вынесено из WorkoutScreen.jsx (техдолг: разбить
// экран на 800+ строк), сам экран остаётся оркестратором стейта.
import { exerciseMetric } from './metric.js'
import { recommendProgression, resolveProgSettings } from './progression.js'
import { plural } from './plural.js'

// Стабильный ключ строки подхода — ТОЛЬКО для React key. В БД/на сервер не идёт
// (cleanEntries сериализует подход как {weight,reps}). Нужен, чтобы при undo-вставке
// подхода в середину React не переиспользовал DOM/значение инпута соседней строки.
// Счётчик — модульный синглтон: и билдер рекомендации, и хендлеры экрана берут ключи
// из одного источника, иначе возможны коллизии _k при вставке.
let _setKeySeq = 0
export const sk = () => `s${++_setKeySeq}`

// Дефолтный подход по типу упражнения (weight=0 у не-весовых, чтобы тоннаж/
// лидерборд не засорять): весовое — 20×10; reps — 10 повторов; time — 60 с (1:00,
// время хранится секундами в reps).
export function defaultSet(ex) {
  const m = exerciseMetric(ex)
  if (m === 'time') return { weight: 0, reps: 60, _k: sk() }
  if (m === 'reps') return { weight: 0, reps: 10, _k: sk() }
  return { weight: 20, reps: 10, _k: sk() }
}

// ── Форматтеры панели автопрогрессии ────────────────────────────────────────

// Русское склонение по числу — общий lib/plural.js.
// «сегодня / вчера / N дней назад» по дате прошлой сессии.
export function daysAgoLabel(iso) {
  if (!iso) return ''
  const then = new Date(iso), now = new Date()
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((b - a) / 86400000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`
}
// Стрелка ветки рекомендации.
export function progArrow(kind) {
  if (kind === 'up' || kind === 'nudge') return '↗'
  if (kind === 'down') return '↘'
  return '='
}
// Тон чипа причины (цвет): вверх/нудж — зелёный, тот же — жёлтый, вниз — красный.
export function progTone(kind) {
  if (kind === 'up' || kind === 'nudge') return 'up'
  if (kind === 'down') return 'down'
  return 'same'
}
// Единица шага прогрессии по метрике (у весовых — кг, даже в стратегии +повт.).
export function progStepUnit(metric) {
  if (metric === 'time') return 'с'
  if (metric === 'reps') return 'повт.'
  return 'кг'
}
// Минимальный/дискретный шаг настройки «Шаг» по метрике.
export function progStepMin(metric) {
  if (metric === 'time') return 5
  if (metric === 'reps') return 1
  return 1.25
}
export function nextProgStep(cur, metric, dir) {
  const d = progStepMin(metric)
  const v = (Number(cur) || d) + dir * d
  return Math.max(d, Math.round(v * 100) / 100)
}
export function fmtProgStep(step, metric) {
  return `${Math.round((Number(step) || 0) * 100) / 100} ${progStepUnit(metric)}`
}

// ── Оркестрация рекомендации ────────────────────────────────────────────────

// Собрать предзаполнение подходов + метаданные панели по недавним сессиям и
// настройкам. Нет истории/выключено/ручной/выкл → sets = копия прошлого или
// дефолт, meta = null (панель не показываем). Иначе — рекомендация + панель.
export function buildRecommendation(ex, sessions, progState) {
  const metric = exerciseMetric(ex)
  const last = sessions[0]?.sets ?? null
  const copyOrDefault = () =>
    last?.length ? last.map((s) => ({ weight: Number(s.weight), reps: Number(s.reps), _k: sk() })) : [defaultSet(ex)]
  // Глобально выключено → никаких панелей.
  if (!progState?.enabled) return { sets: copyOrDefault(), meta: null }

  const settings = resolveProgSettings(progState, ex.id, metric)
  // Ручной/выкл на упражнение: подсказку не даём, но показываем компактную
  // строку-заглушку с шестерёнкой — чтобы стратегию можно было ВЕРНУТЬ (иначе
  // после выбора «ручной» панель с настройками исчезала безвозвратно, UX-ловушка).
  if (settings.strategy === 'manual' || settings.strategy === 'off') {
    return {
      sets: copyOrDefault(),
      meta: {
        muted: true,
        strategy: settings.strategy,
        prev: last?.length ? last.map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })) : null,
        whenIso: sessions[0]?.performed_at ?? null,
        settingsOpen: false,
      },
    }
  }
  // Активная стратегия, но нет истории → рекомендовать нечего (панель не нужна).
  if (!last?.length) return { sets: copyOrDefault(), meta: null }

  const rec = recommendProgression({ metric, lastSets: last, recentSessions: sessions, settings })
  const real = rec.kind === 'up' || rec.kind === 'same' || rec.kind === 'down' || rec.kind === 'nudge'
  if (!real || !rec.sets) return { sets: copyOrDefault(), meta: null }

  return {
    sets: rec.sets.map((s) => ({ weight: s.weight, reps: s.reps, _k: sk() })),
    meta: {
      muted: false,
      prev: last.map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })),
      whenIso: sessions[0].performed_at,
      kind: rec.kind,
      reason: rec.reasonText,
      recSets: rec.sets.map((s) => ({ weight: s.weight, reps: s.reps })),
      changed: rec.changed,
      applied: true,
      settingsOpen: false,
    },
  }
}
