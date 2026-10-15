import { useEffect, useRef, useState } from 'react'
import { speechError } from '../lib/voiceExercises.js'

// Одна короткая фраза через браузерное распознавание (Web Speech API, ru-RU).
// Общий для «Назвать упражнение» в пикере и голосового подхода в карточке
// (v8.7.0, вынесено из ExerciseVoice). Сам ничего не пишет: отдает варианты
// фразы (`phrases`, лучший первым — до 3 альтернатив распознавателя), решение —
// за экраном и подтверждением человека.
// Сессия живет в ref: поздние колбэки старой сессии (после отмены, повторного
// нажатия, размонтирования) отбрасываются сверкой `session.current !== active`.
// Лимит записи стартует с onaudiostart, а не с нажатия: на iOS запрос
// разрешения на микрофон может идти дольше самой записи. `manual` — запасной путь
// экрана для текстов ошибок (по умолчанию «используй поиск»).
export function useSpeech({ limitMs = 15000, manual } = {}) {
  const Recognition = typeof window === 'undefined' ? null
    : window.SpeechRecognition || window.webkitSpeechRecognition
  const session = useRef(null)
  const [recording, setRecording] = useState(false)
  const [listening, setListening] = useState(false)
  const [phrases, setPhrases] = useState([])
  const [error, setError] = useState('')

  function cancel(abort = true) {
    const active = session.current
    session.current = null
    if (active) {
      clearTimeout(active.timer)
      active.rec.onaudiostart = active.rec.onresult = active.rec.onerror = active.rec.onend = null
      try { if (abort) active.rec.abort() } catch { /* already ended */ }
    }
  }

  useEffect(() => () => cancel(), [])

  // Сбросить результат и остановить запись (крестик, выбор варианта).
  function reset() {
    cancel()
    setRecording(false)
    setListening(false)
    setPhrases([])
    setError('')
  }

  // Кнопка микрофона: идет запись — остановить, иначе начать новую фразу.
  function toggle() {
    if (session.current) {
      cancel()
      setRecording(false)
      return
    }
    setPhrases([])
    setError('')
    setListening(false)
    try {
      const rec = new Recognition()
      const active = { rec, timer: null }
      session.current = active
      rec.lang = 'ru-RU'
      rec.continuous = false
      rec.interimResults = false
      rec.maxAlternatives = 3
      const finish = (abort = true) => { cancel(abort); setRecording(false); setListening(false) }
      rec.onresult = (event) => {
        if (session.current !== active) return
        const result = Array.from(event.results).find((r) => r.isFinal)
        if (!result) return
        const list = [...new Set(Array.from(result).map((alt) => alt?.transcript?.trim() ?? '').filter(Boolean))]
        setPhrases(list)
        if (!list.length) setError(speechError('no-speech', manual))
        finish()
      }
      rec.onerror = (event) => {
        if (session.current !== active) return
        setError(speechError(event.error, manual))
        finish()
      }
      rec.onend = () => {
        if (session.current !== active) return
        setError(speechError('no-speech', manual))
        finish(false)
      }
      rec.onaudiostart = () => {
        if (session.current !== active || active.timer !== null) return
        setListening(true)
        active.timer = setTimeout(() => {
          if (session.current !== active) return
          setError(speechError('timeout', manual))
          finish()
        }, limitMs)
      }
      setRecording(true)
      rec.start()
    } catch {
      cancel()
      setRecording(false)
      setError(speechError('start', manual))
    }
  }

  return { supported: Boolean(Recognition), recording, listening, phrases, error, toggle, reset }
}
