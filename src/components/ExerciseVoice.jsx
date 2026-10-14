import { useEffect, useRef, useState } from 'react'
import { speechError, voiceCandidates } from '../lib/voiceExercises.js'

export default function ExerciseVoice({ exercises, onPick }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
  const session = useRef(null)
  const [recording, setRecording] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const candidates = text ? voiceCandidates(text, exercises) : []

  function cancel() {
    const active = session.current
    session.current = null
    if (active) {
      clearTimeout(active.timer)
      active.rec.onresult = active.rec.onerror = active.rec.onend = null
      try { active.rec.abort() } catch { /* already ended */ }
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
    try {
      const rec = new Recognition()
      const active = { rec, timer: null }
      session.current = active
      rec.lang = 'ru-RU'
      rec.continuous = false
      rec.interimResults = false
      rec.maxAlternatives = 1
      const finish = () => { cancel(); setRecording(false) }
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
        finish()
      }
      active.timer = setTimeout(() => {
        if (session.current !== active) return
        setError('Время записи истекло. Повтори или используй поиск.')
        finish()
      }, 15000)
      setRecording(true)
      rec.start()
    } catch {
      cancel()
      setRecording(false)
      setError('Не удалось включить микрофон. Используй поиск или повтори.')
    }
  }

  return (
    <div>
      <button type="button" className="btn outline full" disabled={!Recognition}
        aria-pressed={recording} onClick={start}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        </svg>
        {recording ? 'Остановить запись' : 'Назвать упражнение'}
      </button>
      <p className="muted" role="status">
        {!Recognition ? 'Голосовой ввод недоступен. Используй поиск по названию.'
          : recording ? 'Слушаю… Назови одно упражнение.'
            : 'Голос может требовать интернет. В iOS PWA работа не гарантируется.'}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {text && <div className="create-similar">
        <p>Распознано: «{text}»</p>
        <p role="status">{candidates.length > 1 ? 'Уточни вариант — нажми, чтобы добавить:'
          : candidates.length === 1 ? 'Подтверди добавление:' : 'Ничего не найдено. Повтори или используй поиск.'}</p>
        {candidates.map((ex) => <button type="button" className="similar-item" key={ex.id}
          onClick={() => { cancel(); setText(''); onPick(ex) }}>
          <span>Добавить: {ex.name}</span><span className="picker-group">{ex.muscle_group}</span>
        </button>)}
        <button type="button" className="btn outline" onClick={() => setText('')}>Отменить выбор</button>
      </div>}
    </div>
  )
}
