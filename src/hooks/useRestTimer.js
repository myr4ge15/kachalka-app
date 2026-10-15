import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseRestSettings, parseRestRun, restPhase, startRest, adjustRest, restDurationFor,
  rememberRestDuration, restPushText, REST_LATE_SIGNAL_MS, REST_PUSH_CANCEL_MS,
} from '../lib/restTimer.js'
import { unlockRestAudio, playRestDone, holdScreen, releaseScreen } from '../lib/restSignal.js'
import { vibrate, HAPTIC } from '../lib/haptics.js'
import { scheduleRestPush, cancelRestPush } from '../db/restPush.js'

// Таймер отдыха (v8.8.0, docs/plans/PLAN-rest-timer.md). Логика фаз — чистая
// lib/restTimer.js; здесь — хранение на устройстве, тик, сигнал, Wake Lock и пуш.
//
// Хранение — localStorage, ключи с id учетки (wipeLocalAccount их чистит):
//   gym_app_rest_<id>      — настройки (вкл, звук, вибро, экран, пуш, длительности);
//   gym_app_rest_run_<id>  — идущий отдых { endsAt, durMs, exerciseId, exerciseName }.
// Запуск переживает уход в Ленту, сворачивание и выгрузку PWA: отсчет считается от
// абсолютного endsAt. В Dexie и синк таймер не идет (решение PLAN-workout-focus, Slice 3).
//
// userId — учетка; exercise — { id, name } активной карточки (для «своей» длительности
// и текста пуша); ready — экран загрузил дату; active — таймер показан (новая
// тренировка за сегодня и таймер включен). ready && !active → идущий отдых снимается
// (дату перевели на прошлый день, таймер выключили).

export const restSettingsKey = (userId) => `gym_app_rest_${userId}`
export const restRunKey = (userId) => `gym_app_rest_run_${userId}`

function read(key) {
  try { return globalThis.localStorage?.getItem(key) ?? null } catch { return null }
}
function write(key, value) {
  try {
    if (value == null) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch { /* приватный режим — живем в памяти */ }
}
const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

// Только настройки (для тумблера в Профиле), без тика и сигналов.
export function readRestSettings(userId) {
  return parseRestSettings(read(restSettingsKey(userId)))
}
export function writeRestSettings(userId, settings) {
  write(restSettingsKey(userId), settings)
  if (!settings.on) write(restRunKey(userId), null)
}

export function useRestTimer(userId, { exercise = null, ready = true, active = true } = {}) {
  const [settings, setSettingsState] = useState(() => readRestSettings(userId))
  const [run, setRunState] = useState(() => parseRestRun(read(restRunKey(userId)), Date.now()))
  const [now, setNow] = useState(() => Date.now())
  const signaledRef = useRef(null)  // endsAt, по которому сигнал уже был (или пропущен)
  const cancelledRef = useRef(null) // endsAt, чей пуш уже снят в открытом приложении
  const settingsRef = useRef(settings)
  const runRef = useRef(run)
  useEffect(() => { settingsRef.current = settings; runRef.current = run })

  const state = restPhase(run, now)
  const exId = exercise?.id ?? null
  const exName = exercise?.name ?? null

  const setRun = useCallback((next) => {
    runRef.current = next
    setRunState(next)
    write(restRunKey(userId), next)
    setNow(Date.now())
  }, [userId])

  const setSettings = useCallback((patch) => {
    setSettingsState((prev) => {
      const next = parseRestSettings({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })
      write(restSettingsKey(userId), next)
      return next
    })
  }, [userId])

  const pushFor = useCallback((r, inSec) => {
    if (!settingsRef.current.push || !r) return
    cancelledRef.current = null
    scheduleRestPush(userId, { inSec, ...restPushText(r.exerciseName) })
  }, [userId])

  const start = useCallback((sec) => {
    const t = Date.now()
    const dur = sec ?? restDurationFor(settingsRef.current, exId)
    unlockRestAudio() // в жесте нажатия: к концу отдыха iPhone даст звук
    const r = startRest({ durSec: dur, now: t, exerciseId: exId, exerciseName: exName })
    signaledRef.current = null
    setRun(r)
    pushFor(r, Math.round(r.durMs / 1000))
  }, [exId, exName, setRun, pushFor])

  const stop = useCallback(() => {
    setRun(null)
    cancelRestPush(userId)
  }, [setRun, userId])

  // ±15 с: идет отдых — сдвигаем его конец; не идет (fb_f8717109, 15.10.2026) — меняем
  // запомненную длительность, не запуская; «пора» после конца при этом снимается, чтобы
  // кольцо показало новую длину.
  const adjust = useCallback((deltaSec) => {
    const t = Date.now()
    const prev = runRef.current
    if (!prev || restPhase(prev, t).phase !== 'run') {
      setSettings((s) => rememberRestDuration(s, exId, restDurationFor(s, exId) + deltaSec))
      if (prev) stop()
      return
    }
    const next = adjustRest(prev, deltaSec, t)
    setRun(next)
    const left = Math.round((next.endsAt - t) / 1000)
    if (left >= 1) pushFor(next, left)
    else cancelRestPush(userId)
  }, [userId, pushFor, setRun, setSettings, exId, stop])

  // Выбор пресета: запомнить для упражнения и сразу начать отдых этой длины.
  const choose = useCallback((sec) => {
    setSettings((prev) => rememberRestDuration(prev, exId, sec))
    start(sec)
  }, [exId, setSettings, start])

  // Тик: 4 раза в секунду, пока есть запуск и экран виден (цифры не «перепрыгивают»).
  // Свернули — тик стоит; при возврате пересчет сразу по visibilitychange.
  useEffect(() => {
    function onVis() { setNow(Date.now()) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  useEffect(() => {
    if (!run) return undefined
    const id = setInterval(() => { if (isVisible()) setNow(Date.now()) }, 250)
    return () => clearInterval(id)
  }, [run])

  // Брошенный запуск (перебор больше лимита) — убрать из хранилища.
  useEffect(() => {
    if (run && state.phase === 'idle') { setRunState(null); write(restRunKey(userId), null) }
  }, [run, state.phase, userId])

  // Таймер скрыт (дата в прошлом / выключен) — идущий отдых снимаем вместе с пушем.
  useEffect(() => {
    if (ready && !active && run) stop()
  }, [ready, active, run, stop])

  // Сигнал окончания — один раз на запуск и только «вживую»: открыли приложение
  // через минуту после конца — не пищим задним числом (позвал пуш).
  const endsAt = run?.endsAt ?? null
  const phase = state.phase
  const overMs = state.overMs
  useEffect(() => {
    if (phase !== 'done' || endsAt == null || signaledRef.current === endsAt) return
    if (!isVisible()) return // дождемся возврата: тогда решим по overMs
    signaledRef.current = endsAt
    if (!active || overMs > REST_LATE_SIGNAL_MS) return
    const s = settingsRef.current
    playRestDone(s.sound)
    if (s.vibrate) vibrate(HAPTIC.restDone)
  }, [phase, endsAt, overMs, active])

  // Приложение открыто на последних секундах — снять пуш, сигнал даст оно само.
  const leftMs = state.leftMs
  useEffect(() => {
    if (endsAt == null || cancelledRef.current === endsAt || !isVisible()) return
    if (!settingsRef.current.push) return
    if ((phase === 'run' && leftMs <= REST_PUSH_CANCEL_MS) || phase === 'done') {
      cancelledRef.current = endsAt
      cancelRestPush(userId)
    }
  }, [phase, leftMs, endsAt, userId])

  // Экран не гаснет, пока идет отдых (и пока висит «время!»). Браузер сам снимает
  // блокировку при сворачивании — при возврате берем заново.
  const holding = active && settings.wake && (phase === 'run' || phase === 'done')
  useEffect(() => {
    if (!holding) return undefined
    holdScreen()
    function onVis() { if (isVisible()) holdScreen() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      releaseScreen()
    }
  }, [holding])

  return {
    settings,
    setSettings,
    state,
    run,
    idleSec: restDurationFor(settings, exId),
    start,
    stop,
    adjust,
    choose,
  }
}
