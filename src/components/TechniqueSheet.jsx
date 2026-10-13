import { useEffect, useState } from 'react'
import SheetDialog from './SheetDialog.jsx'
import { labelOf } from '../lib/muscles.js'
import { techniqueFrameUrl } from '../lib/technique.js'

// Подсказка «Как выполнять» (v8.0.0, PLAN-exercise-technique-hints.md): лист поверх
// пикера или тренировки. Справочник грузится лениво — в стартовый бандл не входит,
// но его чанк лежит в precache, так что текст доступен и без сети. Кадры — по
// нажатию; не загрузились — блок кадров просто исчезает, текст остается.
// Лист ничего не меняет в тренировке: только читает справочник.

let contentPromise = null
export function loadTechnique() {
  contentPromise ??= import('../content/technique.js').catch((err) => {
    contentPromise = null // следующая попытка — заново (например, после появления сети)
    throw err
  })
  return contentPromise
}

export default function TechniqueSheet({ slug, name, onClose }) {
  const [state, setState] = useState({ status: 'loading' })
  useEffect(() => {
    let alive = true
    loadTechnique().then(
      (mod) => alive && setState({ status: 'ready', card: mod.TECHNIQUE[slug], source: mod.EVERKINETIC }),
      () => alive && setState({ status: 'error' }),
    )
    return () => { alive = false }
  }, [slug])

  const card = state.card
  return (
    <SheetDialog title={name} onDismiss={onClose} className="sheet--technique">
      <div className="sheet-scroll technique">
        {state.status === 'loading' && <p className="muted">Загружаю подсказку…</p>}
        {(state.status === 'error' || (state.status === 'ready' && !card)) && (
          <p className="muted">Не удалось открыть подсказку. Попробуй ещё раз позже.</p>
        )}
        {card && (
          <>
            {card.frames.length > 0 && <TechniqueFrames frames={card.frames} name={name} />}

            <section className="technique-sec">
              <h3>Мышцы и оборудование</h3>
              <p><span className="muted">Основные:</span> {card.primary.map(labelOf).join(', ')}</p>
              {card.secondary.length > 0 && (
                <p><span className="muted">Помогают:</span> {card.secondary.map(labelOf).join(', ')}</p>
              )}
              <p><span className="muted">Нужно:</span> {card.equipment}</p>
            </section>

            <section className="technique-sec">
              <h3>Как выполнять</h3>
              <ol>{card.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </section>

            <section className="technique-sec">
              <h3>На что обратить внимание</h3>
              <ul className="technique-tips">{card.tips.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>

            <section className="technique-sec">
              <h3>Частые ошибки</h3>
              <ul className="technique-mistakes">{card.mistakes.map((s) => <li key={s}>{s}</li>)}</ul>
            </section>

            {card.frames.length > 0 && (
              <p className="technique-source muted">
                Рисунки: <a href={state.source.url} target="_blank" rel="noopener noreferrer">{state.source.author}</a>,{' '}
                <a href={state.source.licenseUrl} target="_blank" rel="noopener noreferrer">{state.source.license}</a>.
                Подсказка справочная: рабочий вес и прогрессию она не подбирает.
              </p>
            )}
            {card.frames.length === 0 && (
              <p className="technique-source muted">Подсказка справочная: рабочий вес и прогрессию она не подбирает.</p>
            )}
          </>
        )}
      </div>
    </SheetDialog>
  )
}

const FRAME_MS = 1400

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

// Два кадра «по ходу движения». У части пар ракурс разный, поэтому это смена
// кадров с подписью позы, а не морфинг. При reduced-motion — оба кадра рядом,
// без смены. Пауза останавливает смену; выбор позы — тоже пауза.
function TechniqueFrames({ frames, name }) {
  const [reduced] = useState(prefersReducedMotion)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(!reduced)
  const [failed, setFailed] = useState(false)
  const base = import.meta.env.BASE_URL ?? '/'

  useEffect(() => {
    if (!playing || reduced) return undefined
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), FRAME_MS)
    return () => clearInterval(t)
  }, [playing, reduced, frames.length])

  if (failed) return null

  if (reduced) {
    return (
      <div className="technique-frames technique-frames--static">
        {frames.map((f) => (
          <figure key={f.file} className="technique-frame-fig">
            <div className="technique-paper">
              <img src={techniqueFrameUrl(f.file, base)} alt={`${name}: ${f.caption}`} onError={() => setFailed(true)} />
            </div>
            <figcaption className="muted">{f.caption}</figcaption>
          </figure>
        ))}
      </div>
    )
  }

  return (
    <div className="technique-frames">
      <div className="technique-paper technique-stage">
        {frames.map((f, i) => (
          <img
            key={f.file}
            src={techniqueFrameUrl(f.file, base)}
            alt={i === idx ? `${name}: ${f.caption}` : ''}
            aria-hidden={i === idx ? undefined : 'true'}
            className={i === idx ? 'is-on' : ''}
            onError={() => setFailed(true)}
          />
        ))}
      </div>
      <div className="technique-controls">
        <div className="seg" role="group" aria-label="Поза">
          {frames.map((f, i) => (
            <button
              key={f.file}
              type="button"
              className={`seg-item${i === idx ? ' on' : ''}`}
              aria-pressed={i === idx}
              onClick={() => { setPlaying(false); setIdx(i) }}
            >
              {f.caption}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="technique-play"
          aria-label={playing ? 'Остановить смену кадров' : 'Запустить смену кадров'}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>
    </div>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  )
}

// Кнопка «i» рядом с названием упражнения. Отдельная кнопка, а не часть строки:
// нажатие не выбирает упражнение и не трогает тренировку.
export function TechniqueButton({ name, onClick, className = '' }) {
  return (
    <button
      type="button"
      className={`technique-btn${className ? ' ' + className : ''}`}
      aria-label={`Как выполнять: ${name}`}
      title="Как выполнять"
      data-no-sort=""
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.6v.2" />
      </svg>
    </button>
  )
}
