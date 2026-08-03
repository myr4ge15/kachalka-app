// ============================================================================
// RPE — субъективная оценка «как пошло» (PLAN-autoprogression §7). Чистая логика
// БЕЗ Dexie/React/сети.
//
// Автопрогрессия до сих пор выводила «легко» из одних чисел (`easyStreak`: вес не
// рос, повторы закрыты). Это догадка, и врёт она в самом важном месте — когда
// человек добил план, но еле вытянул: числа говорят «+2.5 кг», ощущения — «нет».
// Оценка превращает догадку в факт.
//
// ШКАЛА — три значения: 'easy' | 'ok' | 'hard'. Не 10-балльный RPE и не RIR:
// между подходами человек тычет одной рукой в телефон, выбор из десяти он делать
// не станет. Расширить тройку до пяти позже дешевле, чем сузить.
//
// ГРАНУЛЯРНОСТЬ — одна оценка на упражнение за сессию: ровно та единица, которой
// уже оперирует `easyStreak`, поэтому ветки рекомендации не переделываются.
//
// ХРАНЕНИЕ — род `rpe` в user_meta (локальный ключ `rpe_${userId}`), НЕ внутри
// документа тренировки. Поле подхода тут не годится, и это стоит помнить:
// `repo.cleanEntries` схлопывает подход в `clampSet(weight, reps, metric)`, а
// `sync/pull.js` `rowToDoc` пересобирает `sets` из серверных колонок, где есть
// только вес и повторы, — оценка исчезла бы на первом же `take-server`, молча.
// Форма значения:
//   { [workoutId]: { at: ISO, ex: { [exerciseId]: 'easy'|'ok'|'hard' } } }
// `at` дублирует `performed_at` намеренно: без него карту нечем обрезать, а она
// растёт вечно и целиком уезжает в jsonb при каждом push.
// ============================================================================

import { cmpIsoDesc } from './cmp.js'

// Порядок — от лёгкого к тяжёлому (в этом же порядке рисуются кнопки).
export const FEELS = ['easy', 'ok', 'hard']

// Подписи кнопок. UI на русском (AGENTS.md «Стиль»).
export const FEEL_LABELS = { easy: 'легко', ok: 'нормально', hard: 'тяжело' }

// Сколько тренировок держим в карте. Прогрессии хватает 3–5 последних сессий на
// упражнение, так что 100 тренировок (около года при двух в неделю) — с запасом.
export const RPE_KEEP = 100

// Потолок размера значения. У сервера жёсткий лимит 64 КБ на одно значение
// user_meta (`user_meta value too large`, см. supabase/user-meta.sql), и одной
// обрезки ПО ЧИСЛУ тренировок мало: запись весит ~40 байт плюс ~45 на каждое
// упражнение, поэтому 100 тренировок по 5 упражнений это ~31 КБ, а по 20 —
// уже за лимит. Держим свой потолок ниже серверного: превысить его должно быть
// невозможно, а не «маловероятно».
export const RPE_MAX_BYTES = 60000

// Оценка или null. Любой мусор (старое значение, чужая шкала, undefined) — null:
// отсутствие оценки полностью легально, на нём работает прежняя аппроксимация.
export function normFeel(v) {
  return FEELS.includes(v) ? v : null
}

// Карта оценок в нормальной форме (мусор на входе не должен ронять расчёты).
function normMap(map) {
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {}
}

// Запись одной тренировки в нормальной форме: { at, ex:{...} }.
function normRec(rec) {
  if (!rec || typeof rec !== 'object') return null
  const ex = {}
  for (const [exId, feel] of Object.entries(rec.ex ?? {})) {
    const f = normFeel(feel)
    if (f) ex[exId] = f
  }
  return { at: typeof rec.at === 'string' ? rec.at : '', ex }
}

// Оценки одной тренировки: { [exerciseId]: feel }. Нет записи → пустой объект.
export function feelsForWorkout(map, workoutId) {
  return normRec(normMap(map)[workoutId])?.ex ?? {}
}

// Оценка одного упражнения в одной тренировке (или null).
export function feelFor(map, workoutId, exerciseId) {
  return normFeel(feelsForWorkout(map, workoutId)[exerciseId])
}

// Записать оценки ЦЕЛОЙ тренировки (так их и ставит экран: состав известен
// целиком в момент сохранения). Пустой набор оценок — не пустая запись, а
// ОТСУТСТВИЕ записи: иначе карта копила бы `{ex:{}}` от каждой тренировки, где
// оценку пропустили, а пропуск — основной сценарий (оценка необязательна).
export function putWorkoutFeels(map, workoutId, at, feels) {
  const out = { ...normMap(map) }
  if (!workoutId) return out
  const ex = {}
  for (const [exId, feel] of Object.entries(feels ?? {})) {
    const f = normFeel(feel)
    if (f) ex[exId] = f
  }
  if (Object.keys(ex).length === 0) {
    delete out[workoutId]
    return out
  }
  out[workoutId] = { at: typeof at === 'string' ? at : '', ex }
  return out
}

// Обрезка карты: сначала до `keep` самых свежих тренировок по `at` (новейшие
// сверху), затем — пока значение не влезет в `maxBytes`. Записи без даты считаем
// самыми старыми: они попали в карту из сломанного состояния и уходят первыми.
// Обрезка «снизу» (по дате), а не по счётчику вставок: терять надо старое, до
// которого прогрессии уже нет дела.
export function pruneRpe(map, keep = RPE_KEEP, maxBytes = RPE_MAX_BYTES) {
  const src = normMap(map)
  const sorted = Object.keys(src).sort((a, b) => cmpIsoDesc(src[a]?.at ?? '', src[b]?.at ?? ''))
  let kept = sorted.slice(0, Math.max(0, keep))
  const build = (ids) => {
    const out = {}
    for (const id of ids) out[id] = src[id]
    return out
  }
  let out = build(kept)
  // Размер считаем по сериализации — ровно то, что уедет в jsonb.
  while (kept.length > 1 && JSON.stringify(out).length > maxBytes) {
    kept = kept.slice(0, -1)
    out = build(kept)
  }
  return out
}

// Слияние двух карт при синке. ОБЪЕДИНЕНИЕ, а не last-write-wins: оценка,
// поставленная офлайн на телефоне, обязана пережить синк с ноутбука. LWW
// применяется ТОЛЬКО к спорной паре (workoutId, exerciseId) — то есть когда одну
// и ту же оценку правили на двух устройствах между синками; кто правил позже,
// тот и прав (это решает вызывающий флагом preferLocal).
export function mergeRpe(local, remote, preferLocal = true) {
  const a = normMap(local)
  const b = normMap(remote)
  const out = {}
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = normRec(a[id])
    const y = normRec(b[id])
    if (!x || Object.keys(x.ex).length === 0) { if (y) out[id] = y; continue }
    if (!y || Object.keys(y.ex).length === 0) { out[id] = x; continue }
    out[id] = {
      // Дата тренировки одна и та же с обеих сторон; берём непустую.
      at: x.at || y.at,
      ex: preferLocal ? { ...y.ex, ...x.ex } : { ...x.ex, ...y.ex },
    }
  }
  return pruneRpe(out)
}

// Подмешать оценку в список недавних сессий упражнения (`repo
// .getRecentSessionsForExercise`), чтобы `progression.js` получал её вместе с
// подходами. Сессии без оценки получают `feel: null` — это валидное состояние,
// а не пропуск поля.
export function withFeels(sessions, map, exerciseId) {
  const src = normMap(map)
  return (sessions ?? []).map((s) => ({
    ...s,
    feel: normFeel(normRec(src[s?.id])?.ex?.[exerciseId]),
  }))
}
