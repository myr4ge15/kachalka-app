// Выбор камеры сканера (аудит-серия 8.3.2, просьба владельца 14.10.2026). Чистый модуль.
//
// На iPhone с несколькими объективами (15 Pro и др.) facingMode 'environment' отдает
// ВИРТУАЛЬНУЮ камеру («Back Triple Camera» / «Задняя тройная камера»): iOS сама
// переключает объективы по расстоянию, и у таблички тренажера кадр резко прыгает
// на сверхширокий макро. Если среди камер есть такая виртуальная, берем физическую
// основную («Back Camera» / «Задняя камера», 1×). Иначе (Android, iPhone с одной
// камерой, нет подписей до разрешения) — null: остается поведение по умолчанию.
// Названия Safari локализует, поэтому сверяем по признакам, а не по точной строке.
const BACK = /\bback\b|задн/i
const VIRTUAL = /dual|triple|двойн|тройн/i
const NOT_MAIN = /dual|triple|ultra|wide|tele|двойн|тройн|сверхшир|широк|телефото|теле/i

export function pickMainBackCamera(devices) {
  const back = (devices ?? []).filter((d) => d?.kind === 'videoinput' && d.deviceId && BACK.test(d.label ?? ''))
  if (!back.some((d) => VIRTUAL.test(d.label))) return null
  const main = back.filter((d) => !NOT_MAIN.test(d.label))
  return main.length === 1 ? main[0].deviceId : null
}
