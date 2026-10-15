import { useEffect, useRef, useState } from 'react'
import SheetDialog from '../ui/SheetDialog.jsx'
import { clampOffset, coverScale, cropRect, initialCrop, zoomAt, ZOOM_MAX, ZOOM_MIN } from '../../lib/avatarCrop.js'

const VIEW = 280 // сторона окна обрезки, CSS px

// Ручная обрезка аватара (15.10.2026), как в мессенджерах: квадратное окно с круглой
// рамкой; фото двигается пальцем, масштаб — щипком, колесом или ползунком. Геометрия —
// lib/avatarCrop.js. Пропсы: file (уже декодируемый: HEIC сконвертирован), busy,
// onCancel(), onDone(img, rect) — rect в пикселях исходной картинки.
export default function AvatarCropper({ file, busy = false, onCancel, onDone }) {
  const [src, setSrc] = useState(null)
  const [img, setImg] = useState(null)
  const [st, setSt] = useState(null) // { zoom, x, y }
  const [err, setErr] = useState('')
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    // Отмененная загрузка (смена файла, StrictMode) молчит: иначе ее onerror после
    // revokeObjectURL показал бы ложную ошибку поверх уже загруженного фото.
    let alive = true
    const im = new Image()
    im.onload = () => {
      if (!alive) return
      setImg(im)
      setSt(initialCrop(im.naturalWidth, im.naturalHeight, VIEW))
    }
    im.onerror = () => { if (alive) setErr('Не удалось прочитать изображение') }
    im.src = url
    return () => { alive = false; URL.revokeObjectURL(url) }
  }, [file])

  const geo = img ? { w: img.naturalWidth, h: img.naturalHeight, view: VIEW } : null
  const scale = geo && st ? coverScale(geo.w, geo.h, VIEW) * st.zoom : 1

  function local(e) {
    const r = boxRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  function onDown(e) {
    if (!geo) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    pinch.current = null
  }
  function onMove(e) {
    if (!geo || !pointers.current.has(e.pointerId)) return
    const prev = pointers.current.get(e.pointerId)
    const cur = local(e)
    pointers.current.set(e.pointerId, cur)
    const pts = [...pointers.current.values()]
    if (pts.length >= 2) {
      const [a, b] = pts
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      if (pinch.current) {
        const ratio = dist / pinch.current.dist
        setSt((s) => zoomAt(s, s.zoom * ratio, geo, mid.x, mid.y))
      }
      pinch.current = { dist }
      return
    }
    setSt((s) => ({ ...s, ...clampOffset({ x: s.x + cur.x - prev.x, y: s.y + cur.y - prev.y }, { ...geo, zoom: s.zoom }) }))
  }
  function onUp(e) {
    pointers.current.delete(e.pointerId)
    pinch.current = null
  }
  function onWheel(e) {
    if (!geo) return
    const p = local(e)
    setSt((s) => zoomAt(s, s.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), geo, p.x, p.y))
  }

  return (
    <SheetDialog title="Аватар" actionLabel="отмена" onDismiss={onCancel} dismissDisabled={busy} className="crop-sheet">
      <p className="muted crop-hint">Подвинь фото пальцем, приблизь щипком или ползунком.</p>
      <div ref={boxRef} className="crop-box" style={{ width: VIEW, height: VIEW }} data-no-swipe-back=""
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
        role="img" aria-label="Область обрезки аватара">
        {src && st && geo && (
          <img src={src} alt="" draggable={false} className="crop-img"
            style={{ width: geo.w * scale, height: geo.h * scale, transform: `translate(${st.x}px, ${st.y}px)` }} />
        )}
        <div className="crop-ring" aria-hidden="true" />
      </div>
      {err && <p className="pin-err" role="alert">{err}</p>}
      <label className="crop-zoom">
        <span className="muted">Масштаб</span>
        <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step="0.01" value={st?.zoom ?? 1} disabled={!st || busy}
          aria-label="Масштаб" onChange={(e) => geo && setSt((s) => zoomAt(s, Number(e.target.value), geo))} />
      </label>
      <div className="fc-actions crop-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button type="button" className="btn primary" disabled={!st || busy}
          onClick={() => onDone(img, cropRect(st, geo))}>{busy ? 'Загружаю…' : 'Готово'}</button>
      </div>
    </SheetDialog>
  )
}
