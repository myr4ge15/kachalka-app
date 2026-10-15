// Таймер отдыха (v8.8.0, docs/plans/PLAN-rest-timer.md): чистая логика без React,
// Dexie, сети и браузерных API.
//
// Время считается ТОЛЬКО от абсолютного момента окончания `endsAt` (мс эпохи), а не
// накопленными тиками: свернутое приложение iPhone замораживает, таймеры страницы
// стоят, и после возврата отсчет обязан быть верным сразу. Поэтому «запуск» — это
// объект { endsAt, durMs, exerciseId, exerciseName }, а фаза и остаток вычисляются
// от `now` в момент отрисовки.
//
// Настройки и запуск лежат в localStorage устройства (hooks/useRestTimer.js): таймер —
// свойство телефона в руке, а не данные тренировки; в Dexie и синк он не идет.

export const REST_PRESETS = [60, 90, 120, 180, 240] // секунды — кнопки листа
export const REST_DEFAULT_SEC = 90
export const REST_MIN_SEC = 15
export const REST_MAX_SEC = 600
export const REST_STEP_SEC = 15
// Сколько после конца показывать «Пора» (v8.8.1, просьба владельца 15.10): таймер
// останавливается сам — сигнал, несколько секунд зеленой вспышки и сброс в «ждет».
// До 8.8.1 здесь считался перебор «+0:16» до 10 минут — владельцу это мешало.
export const REST_OVER_LIMIT_MS = 4000
// Звук «догоняет» при возврате в приложение, только если отдых кончился только что:
// пищать задним числом через минуту бессмысленно и пугает.
export const REST_LATE_SIGNAL_MS = 3000
// За сколько до конца отменять пуш, если приложение открыто: сигнал даст само
// приложение, а пуш поверх него был бы дублем. Диспетчер на сервере ходит раз в
// несколько секунд — отмена обязана успеть раньше.
export const REST_PUSH_CANCEL_MS = 4000
// Сколько упражнений помним с «своей» длительностью (старые вытесняются).
export const REST_BY_EX_LIMIT = 200

// Режимы звука (AudioSession API, iOS 17+; на остальных платформах разницы нет):
//   mix  — 'ambient': вместе с музыкой; в беззвучном режиме iPhone молчит;
//   loud — 'playback': звучит и в беззвучном, но ставит музыку на паузу;
//   off  — без звука (остаются вспышка и вибрация).
export const REST_SOUNDS = ['mix', 'loud', 'off']

export const REST_SETTINGS_DEFAULT = Object.freeze({
  on: true,
  sound: 'mix',
  vibrate: true,
  wake: true,
  push: true,
  defaultSec: REST_DEFAULT_SEC,
  byEx: {},
})

export function clampRestSec(sec) {
  const n = Math.round(Number(sec))
  if (!Number.isFinite(n)) return REST_DEFAULT_SEC
  return Math.min(REST_MAX_SEC, Math.max(REST_MIN_SEC, n))
}

// Настройки из хранилища (строка JSON, объект или мусор) → полный объект с
// дефолтами. Неизвестные поля отбрасываются, кривые значения — к дефолту.
export function parseRestSettings(raw) {
  let v = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { v = null }
  }
  if (!v || typeof v !== 'object') return { ...REST_SETTINGS_DEFAULT, byEx: {} }
  const d = REST_SETTINGS_DEFAULT
  const byEx = {}
  if (v.byEx && typeof v.byEx === 'object') {
    for (const [k, s] of Object.entries(v.byEx)) {
      const n = Number(s)
      if (k && Number.isFinite(n)) byEx[k] = clampRestSec(n)
    }
  }
  return {
    on: typeof v.on === 'boolean' ? v.on : d.on,
    sound: REST_SOUNDS.includes(v.sound) ? v.sound : d.sound,
    vibrate: typeof v.vibrate === 'boolean' ? v.vibrate : d.vibrate,
    wake: typeof v.wake === 'boolean' ? v.wake : d.wake,
    push: typeof v.push === 'boolean' ? v.push : d.push,
    defaultSec: v.defaultSec == null ? d.defaultSec : clampRestSec(v.defaultSec),
    byEx,
  }
}

// Длительность для упражнения: своя (последний выбор пресета) или общая.
export function restDurationFor(settings, exerciseId) {
  const own = exerciseId != null ? settings?.byEx?.[String(exerciseId)] : undefined
  return clampRestSec(own ?? settings?.defaultSec ?? REST_DEFAULT_SEC)
}

// Запомнить выбор пресета: для упражнения (если есть) и как общий по умолчанию.
// Свежий ключ — в конец объекта, при переполнении вытесняются самые старые.
export function rememberRestDuration(settings, exerciseId, sec) {
  const s = clampRestSec(sec)
  const next = { ...settings, defaultSec: s, byEx: { ...(settings?.byEx ?? {}) } }
  if (exerciseId != null) {
    const key = String(exerciseId)
    delete next.byEx[key]
    next.byEx[key] = s
    const keys = Object.keys(next.byEx)
    for (let i = 0; i < keys.length - REST_BY_EX_LIMIT; i++) delete next.byEx[keys[i]]
  }
  return next
}

// Новый запуск на durSec секунд от now.
export function startRest({ durSec, now, exerciseId = null, exerciseName = null }) {
  const durMs = clampRestSec(durSec) * 1000
  return {
    endsAt: now + durMs,
    durMs,
    exerciseId: exerciseId == null ? null : String(exerciseId),
    exerciseName: exerciseName ? String(exerciseName) : null,
  }
}

// ±секунды к идущему отдыху. Длительность (для кольца) меняется вместе с концом;
// ниже минимума длительность не опускается, а «−15» на последних секундах просто
// заканчивает отдых сейчас.
export function adjustRest(run, deltaSec, now) {
  if (!run) return run
  const delta = Math.round(Number(deltaSec) || 0) * 1000
  const endsAt = Math.max(now, run.endsAt + delta)
  const durMs = Math.min(REST_MAX_SEC * 1000, Math.max(REST_MIN_SEC * 1000, run.durMs + delta))
  return { ...run, endsAt, durMs }
}

// Фаза запуска на момент now:
//   idle — запуска нет или он кончился больше REST_OVER_LIMIT_MS назад (сброшен);
//   run  — идет отдых, leftMs > 0;
//   done — отдых только что кончился (вспышка «Пора»), overMs — сколько прошло.
// progress — доля прошедшего отдыха 0..1 (для заливки пилюли и кольца).
export function restPhase(run, now) {
  if (!run || !Number.isFinite(run.endsAt) || !Number.isFinite(run.durMs)) {
    return { phase: 'idle', leftMs: 0, overMs: 0, progress: 0 }
  }
  const left = run.endsAt - now
  if (left > 0) {
    const progress = run.durMs > 0 ? Math.min(1, Math.max(0, 1 - left / run.durMs)) : 0
    return { phase: 'run', leftMs: left, overMs: 0, progress }
  }
  const over = -left
  if (over > REST_OVER_LIMIT_MS) return { phase: 'idle', leftMs: 0, overMs: 0, progress: 0 }
  return { phase: 'done', leftMs: 0, overMs: over, progress: 1 }
}

// Запуск из хранилища → объект или null (мусор, брошенный).
export function parseRestRun(raw, now) {
  let v = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return null }
  }
  if (!v || typeof v !== 'object') return null
  const endsAt = Number(v.endsAt)
  const durMs = Number(v.durMs)
  if (!Number.isFinite(endsAt) || !Number.isFinite(durMs) || durMs <= 0) return null
  // Конец дальше максимума от «сейчас» — часы устройства переводили или запись
  // чужая; такой запуск не восстанавливаем.
  if (endsAt - now > REST_MAX_SEC * 1000 + 1000) return null
  const run = {
    endsAt,
    durMs,
    exerciseId: v.exerciseId == null ? null : String(v.exerciseId),
    exerciseName: v.exerciseName ? String(v.exerciseName) : null,
  }
  return restPhase(run, now).phase === 'idle' ? null : run
}

// «1:30». Остаток округляем ВВЕРХ (на старте видно 1:30, а не 1:29; «0:00» не
// показывается, пока отдых идет), перебор — вниз.
export function fmtRest(ms, { up = false } = {}) {
  const raw = Math.max(0, Number(ms) || 0) / 1000
  const total = up ? Math.ceil(raw) : Math.floor(raw)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Фраза для скринридера и подписи кнопки.
export function restAriaLabel(state, idleSec) {
  if (state.phase === 'run') return `Отдых, осталось ${fmtRest(state.leftMs, { up: true })}. Открыть таймер`
  if (state.phase === 'done') return 'Отдых закончился. Начать новый отдых'
  return `Таймер отдыха, ${fmtRest(clampRestSec(idleSec) * 1000)}. Начать`
}

// Текст пуша об окончании (сервер шлет его как есть, длину режет SQL).
export function restPushText(exerciseName) {
  const name = exerciseName ? String(exerciseName).trim().slice(0, 80) : ''
  return {
    title: 'Отдых закончился',
    body: name ? `${name} — пора к следующему подходу` : 'Пора к следующему подходу',
  }
}
