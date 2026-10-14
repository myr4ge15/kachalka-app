import { useEffect, useRef, useState } from 'react'
import { speechError, voiceCandidates } from '../../lib/voiceExercises.js'

export default function ExerciseVoice({ exercises, onPick }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
  const session = useRef(null)
  const [recording, setRecording] = useState(false)
  const [listening, setListening] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const candidates = text ? voiceCandidates(text, exercises) : []

  function cancel(abort = true) {
    const active = session.current
    session.current = null
    if (active) {
      clearTimeout(active.timer)
      active.rec.onaudiostart = active.rec.onresult = active.rec.onerror = active.rec.onend = null
      try { if (abort) active.rec.abort() } catch { /* already ended */ }
    }
  }

  useEffect(() => {
    return () => cancel()
  }, [])

  function start() {
    if (session.current) {
      cancel()
      setRecording(false)
      return
    }
    setText('')
    setError('')
    setListening(false)
    try {
      const rec = new Recognition()
      const active = { rec, timer: null }
      session.current = active
      rec.lang = 'ru-RU'
      rec.continuous = false
      rec.interimResults = false
      rec.maxAlternatives = 1
      const finish = (abort = true) => { cancel(abort); setRecording(false); setListening(false) }
      rec.onresult = (event) => {
        if (session.current !== active) return
        const result = Array.from(event.results).find((r) => r.isFinal)
        if (!result) return
        const transcript = result[0]?.transcript?.trim() ?? ''
        setText(transcript)
        if (!transcript) setError(speechError('no-speech'))
        finish()
      }
      rec.onerror = (event) => {
        if (session.current !== active) return
        setError(speechError(event.error))
        finish()
      }
      rec.onend = () => {
        if (session.current !== active) return
        setError(speechError('no-speech'))
        finish(false)
      }
      // Permission prompts can take longer than the recording itself on iOS.
      // Start the limit only when audio capture actually begins.
      rec.onaudiostart = () => {
        if (session.current !== active || active.timer !== null) return
        setListening(true)
        active.timer = setTimeout(() => {
          if (session.current !== active) return
          setError('Время записи истекло. Повтори или используй поиск.')
          finish()
        }, 15000)
      }
      setRecording(true)
      rec.start()
    } catch {
      cancel()
      setRecording(false)
      setError('Не удалось включить микрофон. Используй поиск или повтори.')
    }
  }

  return (
    <section className="exercise-voice" aria-label="Голосовой ввод">
      <button type="button" className="btn outline full voice-trigger" disabled={!Recognition}
        aria-pressed={recording} onClick={start}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        </svg>
        {recording ? 'Остановить запись' : 'Назвать упражнение'}
      </button>
      <p className="voice-status muted" role="status">
        {!Recognition ? 'Голосовой ввод недоступен. Используй поиск по названию.'
          : recording ? (listening ? 'Слушаю… Назови одно упражнение.' : 'Ожидаю микрофон… Подтверди разрешения, если появится запрос.')
            : ''}
      </p>
      {error && <p className="voice-status error" role="alert">{error}</p>}
      {text && <div className="voice-result">
        <div className="voice-result-head">
          <div className="voice-result-copy">
            <span className="voice-eyebrow">Распознано</span>
            <p className="voice-transcript">«{text}»</p>
          </div>
          <button type="button" className="voice-dismiss" aria-label="Отменить выбор" onClick={() => {
            cancel(); setRecording(false); setListening(false); setText('')
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <p className="voice-hint" role="status">{candidates.length > 1 ? 'Уточни вариант — нажми, чтобы добавить'
          : candidates.length === 1 ? 'Нажми на упражнение, чтобы добавить' : 'Ничего не найдено. Повтори или используй поиск.'}</p>
        <div className="voice-candidates">
          {candidates.map((ex) => <button type="button" className="voice-candidate" key={ex.id}
            aria-label={`Добавить: ${ex.name}`}
            onClick={() => { cancel(); setText(''); onPick(ex) }}>
            <span className="voice-candidate-copy"><span className="voice-candidate-name">{ex.name}</span>
              {ex.muscle_group && <span className="picker-group">{ex.muscle_group}</span>}
            </span>
            <svg className="voice-add" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>)}
        </div>
      </div>}
    </section>
  )
}
