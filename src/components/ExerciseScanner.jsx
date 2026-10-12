import { useEffect, useRef, useState } from 'react'
import SheetDialog from './SheetDialog.jsx'
import { matchScannedText } from '../lib/scannerMatch.js'
import { createScannerWorker } from '../services/scannerOcr.js'
import { frameHasDetail } from '../lib/scannerFrame.js'

export default function ExerciseScanner({ exercises, onPick, onClose, onManual }) {
  const video = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('Запускаем камеру…')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState('')
  const catalog = useRef(exercises)
  useEffect(() => { catalog.current = exercises }, [exercises])

  useEffect(() => {
    let disposed = false, stream, worker, timer, startupTimer, frameTimer, lastKey = '', repeats = 0
    const stop = () => {
      clearTimeout(timer)
      clearTimeout(startupTimer)
      clearTimeout(frameTimer)
      stream?.getTracks().forEach(t => t.stop())
      if (worker) { void worker.terminate(); worker = null }
    }
    const fail = message => {
      if (disposed) return
      disposed = true
      stop()
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
        video.current.srcObject = stream
        await video.current.play()
        if (disposed) return
        setStatus('Подготавливаем распознавание. При первом запуске нужен интернет…')
        worker = await createScannerWorker(() => fail('Не удалось загрузить распознавание. Проверь интернет и повтори.'))
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
            // Central horizontal strip matches the visible guide. Bounded resolution.
            const h = v.videoHeight * 0.5
            canvas.width = Math.min(v.videoWidth, 1280)
            canvas.height = Math.round(h * canvas.width / v.videoWidth)
            context.drawImage(v, 0, v.videoHeight * 0.25, v.videoWidth, h, 0, 0, canvas.width, canvas.height)
            if (!frameHasDetail(context.getImageData(0, 0, canvas.width, canvas.height).data)) {
              lastKey = ''; repeats = 0; setText('')
              setStatus('Не видно надписи. Открой камеру и наведи рамку на название.')
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
            const key = matches.map(m => m.exercise.id).sort().join('|')
            repeats = key && key === lastKey ? repeats + 1 : 1
            lastKey = key
            if (key && repeats >= 2) {
              setResult(matches)
              setStatus('Проверь упражнение перед выбором')
              disposed = true
              stop()
              return
            }
            setStatus(value ? (key ? 'Проверяем название. Держи табличку в рамке…' : 'Совпадение не найдено. Наведи на название ближе или используй ручной поиск.') : 'Поднеси камеру ближе к названию')
            timer = setTimeout(scan, 1200) // scheduled AFTER recognition; never overlapping
          } catch { fail('Распознавание остановилось. Попробуй ещё раз или найди упражнение вручную.') }
        }
        setStatus('Наведите рамку на название тренажера')
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
    setResult(null); setSelected(''); setError(''); setText(''); setStatus('Запускаем камеру…'); setAttempt(n => n + 1)
  }
  const chosen = exercises.find(e => String(e.id) === selected && !e.is_hidden)
  return <SheetDialog title="Сканер названий" actionLabel="назад" onDismiss={onClose}>
    <div className="sheet-scroll scanner">
      {!result && !error && <div className="scanner-camera">
        <video ref={video} autoPlay muted playsInline aria-label="Камера: наведи на название" />
        <div className="scanner-guide" aria-hidden="true" />
      </div>}
      <p role="status">{error || status}</p>
      {result && text && <p className="scanner-text">Название: {text}</p>}
      {result && <>
        <p>{result.length === 1 ? 'Подтверди упражнение:' : 'На табличке несколько вариантов. Выбери нужное движение:'}</p>
        {result.map(({ exercise: e }) => <button key={e.id} className="picker-item"
          aria-pressed={selected === String(e.id)} onClick={() => setSelected(String(e.id))}>
          <span>{e.name}</span><span className="picker-group">{e.muscle_group}</span>
        </button>)}
        <button className="btn primary full" disabled={!chosen} onClick={() => onPick(chosen)}>Выбрать упражнение</button>
      </>}
      {(error || result) && <button className="btn full" onClick={retry}>Повторить сканирование</button>}
      <button className="btn full" onClick={() => onManual(text)}>Найти вручную</button>
      <p className="muted">Камера читает только название в рамке. Кадры остаются на устройстве.</p>
    </div>
  </SheetDialog>
}
