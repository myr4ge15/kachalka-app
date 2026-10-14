import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import SheetDialog from '../ui/SheetDialog.jsx'
import { confidentText, matchScannedText } from '../../lib/scannerMatch.js'
import { trayAdd, trayReplace } from '../../lib/scannerTray.js'
import { pluralize } from '../../lib/plural.js'
import { HAPTIC, vibrate } from '../../lib/haptics.js'
import { createScannerWorker } from '../../services/scannerOcr.js'
import { frameHasDetail, guideCrop } from '../../lib/scannerFrame.js'
import { pickMainBackCamera } from '../../lib/scannerCamera.js'

const TorchButton = ({ torch, onToggle }) => <button type="button" className="scanner-round" aria-label="Фонарик"
  aria-pressed={torch} onClick={onToggle}>
  <svg className="scanner-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"><path d="M7 2h10v5l-3 4v11h-4V11L7 7z" /><path d="M12 14v2" /></svg>
</button>

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

// Два режима. С onPickMany (по умолчанию в тренировке и шаблоне, 8.4.0) — набор, «список
// покупок»: найденное ложится в шторку снизу, сканер продолжает работу. Свернутая шторка
// показывает последнее найденное (остальные — «пачкой» под ним), раскрытая — весь список с
// галочками; «Готово · N» отдает отмеченные в порядке сканирования. Без onPickMany (замена
// упражнения) — прежний одиночный режим: стоп на результате, одно упражнение.
function TrayItem({ exercise, off, onToggle }) {
  return <label className={`scanner-item${off ? ' is-off' : ''}`}>
    <input type="checkbox" className="scanner-item-input" checked={!off} onChange={onToggle} />
    <span className="scanner-check" aria-hidden="true"><Icon><path d="m5 12 5 5L20 7" /></Icon></span>
    <span className="scanner-item-name">{exercise.name}{exercise.muscle_group && <small>{exercise.muscle_group}</small>}</span>
  </label>
}

export default function ExerciseScanner({ exercises, onPick, onPickMany, onClose, onManual }) {
  const trayMode = typeof onPickMany === 'function'
  const [tray, setTray] = useState([]) // все найденное, в порядке сканирования
  const [off, setOff] = useState(() => new Set()) // снятые галочки: строка остается, ее можно вернуть
  const [open, setOpen] = useState(false) // шторка раскрыта
  const [confirm, setConfirm] = useState(false) // «назад» с непустым списком
  const [last, setLast] = useState(null) // { exercise, alts } — последнее найденное сканером
  const trayRef = useRef([])
  const offRef = useRef(off)
  const putTray = next => { trayRef.current = next; setTray(next) }
  const putOff = next => { offRef.current = next; setOff(next) }
  const unOff = id => { if (offRef.current.has(id)) { const n = new Set(offRef.current); n.delete(id); putOff(n) } }
  const addToTray = (exercise, alts = []) => {
    const { tray: next, added } = trayAdd(trayRef.current, exercise)
    if (!added && !offRef.current.has(exercise.id)) return
    if (added) putTray(next)
    unOff(exercise.id) // снятое и снова отсканированное — возвращается
    setLast({ exercise, alts: alts.filter(e => e.id !== exercise.id) })
    vibrate(HAPTIC.success)
  }
  const onStable = useRef(null)
  onStable.current = matches => addToTray(matches[0].exercise, matches.slice(1).map(m => m.exercise))
  const isTray = useRef(trayMode)
  isTray.current = trayMode
  const video = useRef(null)
  const guide = useRef(null)
  const track = useRef(null)
  // Шторка не заходит на рамку: ее высота ограничена местом под рамкой и бейджем под ней
  // (--basket-max), а длинный список листается внутри. Рамка стоит на месте — не прыгает
  // после первого найденного.
  const root = useRef(null)
  const basketOn = trayMode && tray.length > 0
  useLayoutEffect(() => {
    const host = root.current
    if (!host || !basketOn) return
    const put = () => {
      const box = host.getBoundingClientRect(), g = guide.current?.getBoundingClientRect()
      if (!g || !box.height) return
      host.style.setProperty('--basket-max', `${Math.max(200, Math.round(box.bottom - g.bottom - 64))}px`)
    }
    put()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(put)
    ro.observe(host)
    return () => ro.disconnect()
  }, [basketOn])
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
        const size = { width: { ideal: 1280 }, height: { ideal: 720 } }
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: 'environment' }, ...size,
        } })
        if (disposed) { stop(); return }
        // iPhone с несколькими объективами отдал виртуальную камеру, которая сама прыгает
        // между ними: после разрешения подписи камер видны — переоткрываем основную (1×).
        // Любой сбой — остаемся на уже открытой (lib/scannerCamera.js).
        try {
          const main = pickMainBackCamera(await navigator.mediaDevices.enumerateDevices?.())
          const current = stream.getVideoTracks?.()[0]?.getSettings?.().deviceId
          if (main && main !== current && !disposed) {
            const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: main }, ...size } })
            if (disposed) { next.getTracks().forEach(t => t.stop()); stop(); return }
            stream.getTracks().forEach(t => t.stop())
            stream = next
          }
        } catch { /* остаемся на камере по умолчанию */ }
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
            // Построчные данные: уверенность считаем по строкам, а не по всему кадру —
            // наклейки и интерфейс рядом с табличкой больше не топят распознанное название.
            const { data } = await worker.recognize(canvas, {}, { blocks: true })
            clearTimeout(frameTimer)
            if (disposed) return
            const value = String(data?.text ?? '').trim().slice(0, 500)
            const sure = confidentText(data).slice(0, 500)
            const matches = sure ? matchScannedText(sure, catalog.current) : []
            // Only a recognized catalog label is user-facing, never raw OCR noise.
            setText(matches.length ? [...new Set(matches.map(m => m.label))].join(' · ') : '')
            setCandidate(matches[0]?.exercise ?? null)
            const key = matches.map(m => m.exercise.id).sort().join('|')
            repeats = key && key === lastKey ? repeats + 1 : 1
            lastKey = key
            if (key && repeats >= 2 && isTray.current) {
              // Набор: та же табличка в рамке добавляется один раз (на втором совпадении),
              // дальше бейдж показывает «уже в списке», пока не наведут на следующую.
              if (repeats === 2) onStable.current(matches)
              setStatus('Наведи на следующую табличку')
              timer = setTimeout(scan, 1200)
              return
            }
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
          } catch { fail('Распознавание остановилось. Попробуй еще раз или найди упражнение вручную.') }
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

  function inTray(exercise) { return trayMode && !off.has(exercise.id) && tray.some(e => e.id === exercise.id) }
  function swapLast(exercise) {
    putTray(trayReplace(trayRef.current, last.exercise.id, exercise))
    unOff(exercise.id)
    setLast({ exercise, alts: [last.exercise, ...last.alts.filter(e => e.id !== exercise.id)] })
    vibrate(HAPTIC.tap)
  }
  function toggle(id) {
    const n = new Set(offRef.current)
    if (n.has(id)) n.delete(id); else n.add(id)
    putOff(n)
  }
  // Свайп шторки (8.4.1, просьба владельца): вверх — раскрыть, вниз — свернуть. Вниз по списку
  // сворачивает, только когда список пролистан к началу (иначе это обычная прокрутка). Касание,
  // ставшее свайпом, не нажимает строку или кнопку под пальцем.
  const swipe = useRef(null)
  const SWIPE = 36
  function swipeStart(y, target) {
    const list = target?.closest?.('.scanner-checklist')
    swipe.current = { y, list, top: list ? list.scrollTop : 0, moved: 0 }
  }
  function swipeEnd(y) {
    const s = swipe.current
    if (!s) return
    const dy = y - s.y
    if (Math.abs(dy) < SWIPE) { swipe.current = null; return }
    s.moved = Date.now()
    if (dy < 0 && !open && !s.list) setOpen(true)
    else if (dy > 0 && open && (!s.list || (s.top <= 0 && s.list.scrollTop <= 0))) setOpen(false)
  }
  const swipeProps = {
    onTouchStart: e => swipeStart(e.touches[0]?.clientY ?? 0, e.target),
    onTouchEnd: e => swipeEnd(e.changedTouches[0]?.clientY ?? 0),
    onPointerDown: e => { if (e.pointerType === 'mouse') swipeStart(e.clientY, e.target) },
    onPointerUp: e => { if (e.pointerType === 'mouse') swipeEnd(e.clientY) },
    onClickCapture: e => {
      if (!swipe.current?.moved || Date.now() - swipe.current.moved > 500) return
      swipe.current = null
      e.preventDefault(); e.stopPropagation()
    },
  }
  const picked = tray.filter(e => !off.has(e.id))
  function done() { onPickMany(trayRef.current.filter(e => !offRef.current.has(e.id))) }
  function requestClose() {
    if (confirm) setConfirm(false) // «назад» над вопросом — вернуться к сканированию
    else if (trayMode && picked.length) setConfirm(true)
    else onClose()
  }
  const doneLabel = picked.length ? `Готово · ${picked.length}` : 'Ничего не отмечено'

  const [main, ...alts] = result ?? []
  const scanning = !result && !error
  const showTray = trayMode && tray.length > 0
  const swaps = last && inTray(last.exercise) ? last.alts : []
  return <SheetDialog title="Сканер названий" actionLabel="назад" onDismiss={requestClose} className="scanner-sheet">
    <div className="scanner" ref={root}>
      <video ref={video} className="scanner-video" autoPlay muted playsInline aria-label="Камера: наведи на название" />
      {still && <img className="scanner-video" src={still} alt="" />}
      <div className={`scanner-stage${result ? ' is-done' : ''}`}>
        {scanning && <p className="scanner-hint" aria-hidden="true">
          {candidate && !inTray(candidate) ? 'Держи так, проверяю'
            : tray.length ? 'Наведи на следующую табличку' : 'Наведи рамку на табличку тренажера'}</p>}
        <div ref={guide} className={`scanner-guide${result ? ' is-locked' : ''}`} aria-hidden="true">
          {!result && <><i className="scanner-corner tl" /><i className="scanner-corner tr" /><i className="scanner-corner bl" /><i className="scanner-corner br" /></>}
          {scanning && <i className="scanner-line" />}
        </div>
        {scanning && <div className="scanner-status" role="status">
          {candidate && inTray(candidate)
            ? <span className="scanner-badge is-added"><Icon><path d="m5 12 5 5L20 7" /></Icon>
                <span><b>{candidate.name}</b> — уже в списке</span></span>
            : candidate
            ? <button type="button" className="scanner-badge is-tap" onClick={() => trayMode ? addToTray(candidate) : onPick(candidate)}>
                <span className="scanner-ring" aria-hidden="true" />
                <span>Похоже на <b>{candidate.name}</b></span>
                <Icon><path d="m9 6 6 6-6 6" /></Icon>
              </button>
            : <span className="scanner-badge"><span className="scanner-pulse" aria-hidden="true" />{status}</span>}
        </div>}
      </div>

      {scanning && !showTray && <div className="scanner-controls">
        <div className="scanner-row">
          {torch !== null && <TorchButton torch={torch} onToggle={toggleTorch} />}
          <button type="button" className="btn scanner-manual" onClick={() => onManual(text)}>
            <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>Найти вручную</button>
        </div>
      </div>}

      {scanning && showTray && !confirm && <section className={`scanner-basket${open ? ' is-open' : ''}`} aria-label="Список на тренировку" {...swipeProps}>
        <button type="button" className="scanner-grab-btn" aria-expanded={open}
          aria-label={open ? 'Свернуть список' : 'Показать весь список'} onClick={() => setOpen(o => !o)}>
          <span className="scanner-grab" aria-hidden="true" /></button>
        <div className="scanner-basket-head">
          <p className="scanner-eyebrow"><Icon><path d="m5 12 5 5L20 7" /></Icon>
            {open ? `В списке · ${picked.length}` : 'Добавил'}</p>
          {open && <button type="button" className="link-btn scanner-fold" onClick={() => setOpen(false)}>
            Свернуть<Icon><path d="m6 9 6 6 6-6" /></Icon></button>}
        </div>
        {swaps.length > 0 && <div className="scanner-swaps">
          {swaps.map(e => <button type="button" key={e.id} className="link-btn scanner-swap"
            onClick={() => swapLast(e)}>Заменить на «{e.name}»</button>)}
        </div>}
        {open
          ? <div className="scanner-checklist" role="group" aria-label="Набрано сканером">
              {tray.map(e => <TrayItem key={e.id} exercise={e} off={off.has(e.id)}
                onToggle={() => toggle(e.id)} />)}
            </div>
          : <div className="scanner-stack" data-depth={Math.min(tray.length - 1, 2)}>
              {(() => { const e = tray.find(x => x.id === last?.exercise.id) ?? tray[tray.length - 1]
                return <TrayItem exercise={e} off={off.has(e.id)} onToggle={() => toggle(e.id)} /> })()}
            </div>}
        {!open && tray.length > 1 && <button type="button" className="link-btn scanner-more" onClick={() => setOpen(true)}>
          Еще {tray.length - 1} в списке — показать</button>}
        <div className="scanner-row">
          {torch !== null && <TorchButton torch={torch} onToggle={toggleTorch} />}
          <button type="button" className="btn primary scanner-manual" disabled={!picked.length} onClick={done}>{doneLabel}</button>
        </div>
      </section>}

      {confirm && <div className="scanner-panel scanner-confirm" role="alertdialog" aria-labelledby="scanner-confirm-title">
        <span className="scanner-grab" aria-hidden="true" />
        <h2 id="scanner-confirm-title" className="scanner-confirm-title">Добавить найденное?</h2>
        <p className="muted">В списке {pluralize(picked.length, 'упражнение', 'упражнения', 'упражнений')}.</p>
        <button type="button" className="btn primary full" onClick={done}>
          Добавить {pluralize(picked.length, 'упражнение', 'упражнения', 'упражнений')}</button>
        <button type="button" className="btn full" onClick={onClose}>Закрыть без них</button>
        <button type="button" className="link-btn scanner-again" onClick={() => setConfirm(false)}>Сканировать дальше</button>
      </div>}

      {error && <div className="scanner-panel scanner-error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn primary full" onClick={retry}>Повторить сканирование</button>
        {trayMode && picked.length > 0
          ? <button type="button" className="btn full" onClick={done}>{doneLabel}</button>
          : <button type="button" className="btn full" onClick={() => onManual(text)}>Найти вручную</button>}
      </div>}

      {main && <div className="scanner-panel scanner-result">
        <span className="scanner-grab" aria-hidden="true" />
        <p className="scanner-eyebrow"><Icon><path d="m5 12 5 5L20 7" /></Icon>Нашел на табличке</p>
        <h2 className="scanner-name">{main.exercise.name}</h2>
        {main.exercise.muscle_group && <div className="scanner-tags">
          <span className="chip scanner-tag">{main.exercise.muscle_group}</span></div>}
        <button type="button" className="btn primary full" onClick={() => onPick(main.exercise)}>Добавить в тренировку</button>
        {alts.length > 0 && <div className="scanner-alts">
          <p className="muted">Еще на табличке</p>
          {alts.map(({ exercise: e }) => <button type="button" key={e.id} className="scanner-alt" onClick={() => onPick(e)}>
            <span>{e.name}<small>{e.muscle_group}</small></span>
            <Icon><path d="m9 6 6 6-6 6" /></Icon>
          </button>)}
        </div>}
        <button type="button" className="link-btn scanner-again" onClick={retry}>Сканировать еще</button>
      </div>}
    </div>
  </SheetDialog>
}
