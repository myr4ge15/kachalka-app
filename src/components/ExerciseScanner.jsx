import { useEffect, useRef, useState } from 'react'
import SheetDialog from './SheetDialog.jsx'
import { matchScannedText } from '../lib/scannerMatch.js'
import { createScannerWorker } from '../services/scannerOcr.js'
import { frameHasDetail, guideCrop } from '../lib/scannerFrame.js'

const Icon = ({ children }) => <svg className="scanner-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>

// Snapshot of the last frame: the result sheet sits over a frozen picture,
// not over a black stopped stream. Best effort — without it the stage stays dark.
function snapshot(video) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.min(video.videoWidth, 720)
    canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth)
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7) || ''
  } catch { return '' }
}

const SLOW_START = 'Готовлю распознавание. В первый раз нужен интернет…'
const SLOW_START_MS = 800

export default function ExerciseScanner({ exercises, onPick, onClose, onManual }) {
  const video = useRef(null)
  const guide = useRef(null)
  const track = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('Запускаем камеру…')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [candidate, setCandidate] = useState(null)
  const [still, setStill] = useState('')
  const [torch, setTorch] = useState(null) // null — no torch; false/true — off/on
  const catalog = useRef(exercises)
  useEffect(() => { catalog.current = exercises }, [exercises])

  useEffect(() => {
    let disposed = false, stream, worker, timer, startupTimer, frameTimer, slowTimer, lastKey = '', repeats = 0
    const stop = () => {
      clearTimeout(timer)
      clearTimeout(startupTimer)
      clearTimeout(frameTimer)
      clearTimeout(slowTimer)
      stream?.getTracks().forEach(t => t.stop()) // a stopped track also turns the torch off
      track.current = null
      if (worker) { void worker.terminate(); worker = null }
    }
    const fail = message => {
      if (disposed) return
      disposed = true
      stop()
      setCandidate(null); setTorch(null)
      setError(message)
    }
    const visibility = () => {
      if (document.hidden) fail('Сканирование остановлено. Нажми «Повторить», когда будешь готов.')
    }
    document.addEventListener('visibilitychange', visibility)
    startupTimer = setTimeout(() => fail('Запуск занял слишком долго. Проверь разрешение камеры и интернет, затем повтори.'), 60_000)
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          fail('Камера недоступна. Открой приложение по HTTPS или воспользуйся ручным поиском.')
          return
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 },
        } })
        if (disposed) { stop(); return }
        const camera = stream.getVideoTracks?.()[0]
        track.current = camera ?? null
        // Torch: Android Chrome and iOS 17+ report it; elsewhere the button stays hidden.
        try { if (camera?.getCapabilities?.()?.torch) setTorch(false) } catch { /* no capabilities */ }
        video.current.srcObject = stream
        await video.current.play()
        if (disposed) return
        // From cache the worker is ready in ~100 ms: a long two-line badge would only flash.
        // Show it only when loading is really slow (first run, weak network).
        slowTimer = setTimeout(() => { if (!disposed) setStatus(SLOW_START) }, SLOW_START_MS)
        worker = await createScannerWorker(() => fail('Не удалось загрузить распознавание. Проверь интернет и повтори.'))
        clearTimeout(slowTimer)
        if (disposed) { stop(); return }
        await worker.setParameters({ tessedit_pageseg_mode: '11' })
        if (disposed) return
        clearTimeout(startupTimer)
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        async function scan() {
          if (disposed) return
          try {
            const v = video.current
            if (!v?.videoWidth) { timer = setTimeout(scan, 600); return }
            // Read exactly what the on-screen guide frames. Bounded resolution.
            const { sx, sy, sw, sh } = guideCrop(v.videoWidth, v.videoHeight, v.getBoundingClientRect(), guide.current?.getBoundingClientRect())
            canvas.width = Math.min(sw, 1280)
            canvas.height = Math.max(1, Math.round(sh * canvas.width / sw))
            context.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
            if (!frameHasDetail(context.getImageData(0, 0, canvas.width, canvas.height).data)) {
              lastKey = ''; repeats = 0; setText(''); setCandidate(null)
              setStatus('Не видно надписи')
              timer = setTimeout(scan, 1200)
              return
            }
            frameTimer = setTimeout(() => fail('Не удалось прочитать кадр вовремя. Попробуй повторить или используй ручной поиск.'), 30_000)
            const { data } = await worker.recognize(canvas)
            clearTimeout(frameTimer)
            if (disposed) return
            const value = data.text.trim().slice(0, 500)
            const matches = data.confidence >= 45 ? matchScannedText(value, catalog.current) : []
            // Only a recognized catalog label is user-facing, never raw OCR noise.
            setText(matches.length ? [...new Set(matches.map(m => m.label))].join(' · ') : '')
            setCandidate(matches[0]?.exercise ?? null)
            const key = matches.map(m => m.exercise.id).sort().join('|')
            repeats = key && key === lastKey ? repeats + 1 : 1
            lastKey = key
            if (key && repeats >= 2) {
              setStill(snapshot(v))
              setResult(matches)
              setCandidate(null); setTorch(null)
              disposed = true
              stop()
              return
            }
            setStatus(value ? (key ? 'Проверяю название…' : 'Не узнал. Поднеси ближе') : 'Поднеси ближе')
            timer = setTimeout(scan, 1200) // scheduled AFTER recognition; never overlapping
          } catch { fail('Распознавание остановилось. Попробуй ещё раз или найди упражнение вручную.') }
        }
        setStatus('Ищу название…')
        void scan()
      } catch (err) {
        fail(err?.name === 'NotAllowedError'
          ? 'Нет доступа к камере. Разреши камеру в настройках сайта или воспользуйся ручным поиском.'
          : 'Не удалось запустить камеру или распознавание. Проверь камеру и интернет.')
      }
    }
    void start()
    return () => { disposed = true; stop(); document.removeEventListener('visibilitychange', visibility) }
  }, [attempt])

  function retry() {
    setResult(null); setError(''); setText(''); setCandidate(null); setStill(''); setTorch(null)
    setStatus('Запускаем камеру…'); setAttempt(n => n + 1)
  }
  async function toggleTorch() {
    const next = !torch
    try {
      await track.current.applyConstraints({ advanced: [{ torch: next }] })
      setTorch(next)
    } catch { setTorch(null) } // the camera refused: hide the button, scanning goes on
  }

  const [main, ...alts] = result ?? []
  const scanning = !result && !error
  return <SheetDialog title="Сканер названий" actionLabel="назад" onDismiss={onClose} className="scanner-sheet">
    <div className="scanner">
      <video ref={video} className="scanner-video" autoPlay muted playsInline aria-label="Камера: наведи на название" />
      {still && <img className="scanner-video" src={still} alt="" />}
      <div className={`scanner-stage${result ? ' is-done' : ''}`}>
        {scanning && <p className="scanner-hint" aria-hidden="true">
          {candidate ? 'Держи так, проверяю' : 'Наведи рамку на табличку тренажера'}</p>}
        <div ref={guide} className={`scanner-guide${result ? ' is-locked' : ''}`} aria-hidden="true">
          {!result && <><i className="scanner-corner tl" /><i className="scanner-corner tr" /><i className="scanner-corner bl" /><i className="scanner-corner br" /></>}
          {scanning && <i className="scanner-line" />}
        </div>
        {scanning && <div className="scanner-status" role="status">
          {candidate
            ? <button type="button" className="scanner-badge is-tap" onClick={() => onPick(candidate)}>
                <span className="scanner-ring" aria-hidden="true" />
                <span>Похоже на <b>{candidate.name}</b></span>
                <Icon><path d="m9 6 6 6-6 6" /></Icon>
              </button>
            : <span className="scanner-badge"><span className="scanner-pulse" aria-hidden="true" />{status}</span>}
        </div>}
      </div>

      {scanning && <div className="scanner-controls">
        <div className="scanner-row">
          {torch !== null && <button type="button" className="scanner-round" aria-label="Фонарик"
            aria-pressed={torch} onClick={toggleTorch}>
            <Icon><path d="M7 2h10v5l-3 4v11h-4V11L7 7z" /><path d="M12 14v2" /></Icon>
          </button>}
          <button type="button" className="btn scanner-manual" onClick={() => onManual(text)}>
            <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>Найти вручную</button>
        </div>
        <p className="scanner-note">Кадры остаются на устройстве</p>
      </div>}

      {error && <div className="scanner-panel scanner-error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn primary full" onClick={retry}>Повторить сканирование</button>
        <button type="button" className="btn full" onClick={() => onManual(text)}>Найти вручную</button>
      </div>}

      {main && <div className="scanner-panel scanner-result">
        <span className="scanner-grab" aria-hidden="true" />
        <p className="scanner-eyebrow"><Icon><path d="m5 12 5 5L20 7" /></Icon>Нашёл на табличке</p>
        <h2 className="scanner-name">{main.exercise.name}</h2>
        {main.exercise.muscle_group && <div className="scanner-tags">
          <span className="chip scanner-tag">{main.exercise.muscle_group}</span></div>}
        <button type="button" className="btn primary full" onClick={() => onPick(main.exercise)}>Добавить в тренировку</button>
        {alts.length > 0 && <div className="scanner-alts">
          <p className="muted">Ещё на табличке</p>
          {alts.map(({ exercise: e }) => <button type="button" key={e.id} className="scanner-alt" onClick={() => onPick(e)}>
            <span>{e.name}<small>{e.muscle_group}</small></span>
            <Icon><path d="m9 6 6 6-6 6" /></Icon>
          </button>)}
        </div>}
        <button type="button" className="link-btn scanner-again" onClick={retry}>Сканировать ещё</button>
      </div>}
    </div>
  </SheetDialog>
}
