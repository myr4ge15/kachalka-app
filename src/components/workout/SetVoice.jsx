import { useMemo, useState } from 'react'
import { useSpeech } from '../../hooks/useSpeech.js'
import { exerciseMetric, fmtSet } from '../../lib/metric.js'
import { bestSetPhrase, mergeVoiceSet, voiceSetTarget } from '../../lib/voiceCommand.js'
import { defaultSet } from '../../lib/progressionCard.js'
import { CloseIcon, MicIcon } from '../exercises/ExerciseVoice.jsx'

// Подход голосом в карточке упражнения (v8.7.0): микрофон рядом с «+ подход».
// «60 на 12», «12 раз», «второй подход 60 на 10», «еще 60 на 12». Ничего не пишет
// само: показывает, какая строка изменится и на что, — записывает кнопка.
// Строка по умолчанию — `cursor` (следующая после последней записанной голосом;
// экран держит его на упражнение), человек может выбрать другую или «новый».
// `children` — кнопка «+ подход»: стоит в одном ряду с микрофоном.
// Только «вес × повторы» и «свой вес»: время и дистанцию голосом не разбираем.
export default function SetVoice({ exercise, sets, cursor = 0, onCommit, children }) {
  const speech = useSpeech({ manual: 'введи в строке подхода' })
  const metric = exerciseMetric(exercise)
  const { phrase, set } = useMemo(() => bestSetPhrase(speech.phrases), [speech.phrases])
  // Выбор строки вручную действует только для этой фразы.
  const [choice, setChoice] = useState({ phrases: null, si: 0 })
  const si = choice.phrases === speech.phrases ? choice.si : voiceSetTarget(set, sets.length, cursor)
  const isNew = si === sets.length
  const base = isNew ? sets[sets.length - 1] ?? defaultSet(exercise) : sets[si]
  const next = si >= 0 ? mergeVoiceSet(set, base, metric) : null

  // Без распознавания — тот же ряд, но без микрофона (в ряду бывает и таймер отдыха, v8.8.1).
  if (!speech.supported) return <div className="set-add-row">{children}</div>

  const label = isNew ? `Новый подход ${si + 1}` : `Подход ${si + 1}`
  const problem = si < 0 ? `Подхода ${set.setNo} нет — сейчас их ${sets.length}.`
    : set?.error ? 'Слишком много чисел. Скажи, например: «60 на 12».'
      : !next ? 'Не понял вес и повторы. Скажи, например: «60 на 12» или «12 раз».' : ''

  return (
    <div className="set-voice">
      <div className="set-add-row">
        {children}
        <button type="button" className="set-voice-btn" aria-pressed={speech.recording}
          aria-label={speech.recording ? 'Остановить запись' : 'Сказать подход голосом'}
          onClick={speech.toggle}>
          <MicIcon size={18} />
        </button>
      </div>
      {speech.recording && (
        <p className="voice-status muted" role="status">
          {speech.listening ? 'Слушаю… Например: «60 на 12» или «второй подход 12 раз».'
            : 'Ожидаю микрофон… Подтверди разрешения, если появится запрос.'}
        </p>
      )}
      {speech.error && <p className="voice-status error" role="alert">{speech.error}</p>}
      {phrase && (
        <div className="voice-result set-voice-result">
          <div className="voice-result-head">
            <div className="voice-result-copy">
              <span className="voice-eyebrow">Распознано</span>
              <p className="voice-transcript">«{phrase}»</p>
            </div>
            <button type="button" className="voice-dismiss" aria-label="Отменить подход голосом" onClick={speech.reset}>
              <CloseIcon />
            </button>
          </div>
          {problem ? <p className="voice-hint voice-problem" role="alert">{problem}</p> : (
            <>
              <div className="set-voice-rows" role="group" aria-label="Куда записать">
                {sets.map((_, i) => (
                  <button key={i} type="button" className="set-voice-row" aria-pressed={i === si}
                    aria-label={`В подход ${i + 1}`} onClick={() => setChoice({ phrases: speech.phrases, si: i })}>
                    {i + 1}
                  </button>
                ))}
                <button type="button" className="set-voice-row set-voice-row--new" aria-pressed={isNew}
                  onClick={() => setChoice({ phrases: speech.phrases, si: sets.length })}>+ новый</button>
              </div>
              <p className="set-voice-preview" role="status">
                <span className="muted">{label}: </span>
                {!isNew && <><s className="muted">{fmtSet(metric, base)}</s>{' → '}</>}
                <b>{fmtSet(metric, next)}</b>
              </p>
              <button type="button" className="btn primary set-voice-save"
                onClick={() => { onCommit(si, next); speech.reset() }}>
                Записать
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
