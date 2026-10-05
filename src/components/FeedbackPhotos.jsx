import { useEffect, useRef, useState } from 'react'
import SheetDialog from './SheetDialog.jsx'
import { dragOpacity, shouldDismiss } from '../lib/swipeDismiss.js'

// Картинки обращения из Telegram (v6.12.0): фото ответа разработчика или скриншот
// участника. Хранятся в Telegram, байты отдает Edge `feedback` — load(id, kind, n)
// возвращает object URL (lib/feedbackApi.js feedbackMedia, с кэшем на сессию).
// Тап по превью — картинка на весь экран; закрыть — «закрыть» или свайпом вверх/вниз.
//
// lazy — сначала кнопка «Показать», грузим по нажатию (Админка: не тянуть байты
// всех обращений сразу). label — подпись кнопки и alt.
export default function FeedbackPhotos({ id, kind = 'reply', count = 1, load, lazy = false, label = 'Скриншот', disabled = false }) {
  const [on, setOn] = useState(!lazy)
  const [urls, setUrls] = useState(() => Array(count).fill(null)) // null — грузится, '' — не вышло
  const [open, setOpen] = useState(null)

  useEffect(() => {
    if (!on || !count) return undefined
    let alive = true
    setUrls(Array(count).fill(null))
    for (let n = 0; n < count; n++) {
      Promise.resolve(load(id, kind, n))
        .then((url) => url, () => '')
        .then((url) => { if (alive) setUrls((cur) => cur.map((u, i) => (i === n ? url : u))) })
    }
    return () => { alive = false }
  }, [on, id, kind, count, load])

  if (!count) return null
  if (!on) {
    return (
      <button type="button" className="btn ghost fb-attach" onClick={() => setOn(true)} disabled={disabled}>
        📎 Показать {count > 1 ? `${label.toLowerCase()} (${count})` : label.toLowerCase()}
      </button>
    )
  }

  return (
    <>
      <div className="fb-photos">
        {urls.map((url, n) => (
          url === ''
            ? <span key={n} className="fb-photo fb-photo--gone" role="img" aria-label="Картинка недоступна">🖼️</span>
            : url === null
              ? <span key={n} className="fb-photo skel" aria-label="Загрузка" />
              : (
                <button key={n} type="button" className="fb-photo" onClick={() => setOpen(url)}
                  aria-label={count > 1 ? `${label} ${n + 1} из ${count}` : label}>
                  <img src={url} alt="" />
                </button>
              )
        ))}
      </div>
      {open && (
        <SheetDialog title={label} onDismiss={() => setOpen(null)} className="fb-viewer">
          <SwipeToClose onClose={() => setOpen(null)}>
            <img src={open} alt={label} />
          </SwipeToClose>
        </SheetDialog>
      )}
    </>
  )
}

// Картинка тянется за пальцем по вертикали; отпустили далеко или резко — закрыть,
// иначе вернуть на место. Один палец; щипок (два пальца) не перехватываем.
function SwipeToClose({ onClose, children }) {
  const start = useRef(null)
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)

  function onTouchStart(e) {
    if (e.touches.length !== 1) { start.current = null; return }
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, at: Date.now() }
    setDragging(true)
  }
  function onTouchMove(e) {
    if (!start.current || e.touches.length !== 1) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const y = t.clientY - start.current.y
    if (Math.abs(y) > Math.abs(dx)) setDy(y)
  }
  function onTouchEnd(e) {
    const s = start.current
    start.current = null
    setDragging(false)
    if (!s) return
    const t = e.changedTouches?.[0]
    const dx = t ? t.clientX - s.x : 0
    const y = t ? t.clientY - s.y : dy
    if (shouldDismiss({ dx, dy: y, dt: Date.now() - s.at })) onClose()
    else setDy(0)
  }

  return (
    <div className="fb-viewer-body" onTouchStart={onTouchStart} onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd} onTouchCancel={() => { start.current = null; setDragging(false); setDy(0) }}>
      <div className={dragging ? 'fb-viewer-drag' : 'fb-viewer-drag fb-viewer-drag--settle'}
        style={{ transform: dy ? `translateY(${dy}px)` : undefined, opacity: dy ? dragOpacity(dy) : undefined }}>
        {children}
      </div>
    </div>
  )
}
