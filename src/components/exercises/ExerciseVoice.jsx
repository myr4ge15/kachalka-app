import { useMemo } from 'react'
import { useSpeech } from '../../hooks/useSpeech.js'
import { bestVoicePhrase } from '../../lib/voiceExercises.js'
import { parseVoiceCommand } from '../../lib/voiceCommand.js'
import Icon from '../ui/Icon.jsx'

// Сколько вариантов показывать: на «жим» справочник отдает десятки строк, а это
// подсказка, а не второй список пикера — дальше человек уточнит поиском.
const MAX_CANDIDATES = 6

// «Назвать упражнение» в пикере. Голос только подбирает варианты: добавление —
// тапом по кандидату через обычный onPick. `onSearch(text)` — перенести фразу в
// строку поиска пикера («Искать «…»»), когда варианты не те или их нет.
export default function ExerciseVoice({ exercises, onPick, onSearch }) {
  const speech = useSpeech()
  const { phrase, candidates } = useMemo(
    () => bestVoicePhrase(speech.phrases, exercises),
    [speech.phrases, exercises],
  )
  const command = phrase ? parseVoiceCommand(phrase) : null
  const shown = candidates.slice(0, MAX_CANDIDATES)
  const recording = speech.recording

  return (
    <section className="exercise-voice" aria-label="Голосовой ввод">
      <button type="button" className="btn outline full voice-trigger" disabled={!speech.supported}
        aria-pressed={recording} onClick={speech.toggle}>
        <MicIcon />
        {recording ? 'Остановить запись' : 'Назвать упражнение'}
      </button>
      <p className="voice-status muted" role="status">
        {!speech.supported ? 'Голосовой ввод недоступен. Используй поиск по названию.'
          : recording ? (speech.listening ? 'Слушаю… Назови одно упражнение.' : 'Ожидаю микрофон… Подтверди разрешения, если появится запрос.')
            : ''}
      </p>
      {speech.error && <p className="voice-status error" role="alert">{speech.error}</p>}
      {phrase && <div className="voice-result">
        <div className="voice-result-head">
          <div className="voice-result-copy">
            <span className="voice-eyebrow">Распознано</span>
            <p className="voice-transcript">«{phrase}»</p>
          </div>
          <button type="button" className="voice-dismiss" aria-label="Отменить выбор" onClick={speech.reset}>
            <CloseIcon />
          </button>
        </div>
        <p className="voice-hint" role="status">{shown.length > 1 ? 'Уточни вариант — нажми, чтобы добавить'
          : shown.length === 1 ? 'Нажми на упражнение, чтобы добавить' : 'Ничего не найдено. Повтори или поищи по названию.'}</p>
        {command?.set && !command.set.error && command.query && (
          <p className="voice-hint voice-note">Вес и повторы здесь не записываются — скажи их в карточке упражнения.</p>
        )}
        <div className="voice-candidates">
          {shown.map((ex) => <button type="button" className="voice-candidate" key={ex.id}
            aria-label={`Добавить: ${ex.name}`}
            onClick={() => { speech.reset(); onPick(ex) }}>
            <span className="voice-candidate-copy"><span className="voice-candidate-name">{ex.name}</span>
              {ex.muscle_group && <span className="picker-group">{ex.muscle_group}</span>}
            </span>
            <svg className="voice-add" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>)}
        </div>
        {onSearch && command?.query && (
          <button type="button" className="voice-search" onClick={() => { speech.reset(); onSearch(command.query) }}>
            Искать «{command.query}» в списке
          </button>
        )}
      </div>}
    </section>
  )
}

export function MicIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </svg>
  )
}

export function CloseIcon() {
  return <Icon name="close" size={20} />
}
