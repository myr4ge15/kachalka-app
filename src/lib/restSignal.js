// Сигнал и «не гасить экран» для таймера отдыха (v8.8.0). Браузерные API за
// try/catch — как lib/haptics.js: на неподдерживающей платформе тихий no-op.
//
// Звук — Web Audio (два коротких тона, без файлов). На iPhone AudioContext звучит
// только после жеста пользователя, поэтому `unlockRestAudio()` зовется из нажатия
// «старт» — к окончанию отдыха контекст уже разблокирован.
//
// Режим звука на iPhone (AudioSession API, iOS 17+; см. PLAN-rest-timer.md §3):
//   mix  → 'transient' — поверх музыки, приглушая ее; в беззвучном режиме молчит;
//   loud → 'playback'  — звучит и в беззвучном, но ставит музыку на паузу.
// Тип ставим прямо перед сигналом и возвращаем 'auto' после: 'playback', оставленный
// навсегда, ставил бы музыку на паузу при любом звуке страницы, а микрофон голосового
// ввода (hooks/useSpeech.js) должен получать поведение по умолчанию.

let ctx = null

function audioCtor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext || window.webkitAudioContext || null
}

export function unlockRestAudio() {
  try {
    const Ctor = audioCtor()
    if (!Ctor) return false
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') ctx.resume?.()
    // Пустой буфер в жесте — так iOS окончательно «отпускает» контекст.
    const buf = ctx.createBuffer(1, 1, 22050)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
    return true
  } catch {
    return false
  }
}

function setSessionType(type) {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.audioSession : null
    if (s && 'type' in s) s.type = type
  } catch { /* AudioSession нет — платформа сама решит */ }
}

// Два тона по 150 мс. Возвращает true, если звук запрошен у платформы.
export function playRestDone(sound = 'mix') {
  if (sound === 'off') return false
  try {
    const Ctor = audioCtor()
    if (!Ctor) return false
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') ctx.resume?.()
    setSessionType(sound === 'loud' ? 'playback' : 'transient')
    const t0 = ctx.currentTime + 0.02
    for (const d of [0, 0.22]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.0001, t0 + d)
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.16)
      osc.start(t0 + d)
      osc.stop(t0 + d + 0.18)
    }
    setTimeout(() => setSessionType('auto'), 800)
    return true
  } catch {
    return false
  }
}

// Screen Wake Lock: экран не гаснет, пока идет отдых. Браузер сам снимает блокировку
// при сворачивании, поэтому при возврате ее берут заново (hooks/useRestTimer.js).
let sentinel = null

export async function holdScreen() {
  try {
    if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) return false
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
    if (sentinel && !sentinel.released) return true
    sentinel = await navigator.wakeLock.request('screen')
    return true
  } catch {
    sentinel = null
    return false
  }
}

export function releaseScreen() {
  const s = sentinel
  sentinel = null
  try { s?.release?.() } catch { /* уже снята */ }
}
