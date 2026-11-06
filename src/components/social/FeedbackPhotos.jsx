import { useEffect, useRef, useState } from 'react'
import SheetDialog from '../ui/SheetDialog.jsx'
import { dragOpacity, shouldDismiss } from '../../lib/swipeDismiss.js'
import { isVideoMedia, videoPosterSrc } from '../../lib/feedback.js'
import Icon from '../ui/Icon.jsx'
import Chevron from '../ui/Chevron.jsx'

// Картинки обращения из Telegram (v6.12.0): фото ответа разработчика или скриншот
// участника. Хранятся в Telegram, байты отдает Edge `feedback` — load(id, kind, n)
// возвращает object URL (lib/feedbackApi.js feedbackMedia, с кэшем на сессию).
// Тап по превью — картинка на весь экран; закрыть — «закрыть» или свайпом вверх/вниз.
//
// lazy — сначала кнопка «Показать», грузим по нажатию (Админка: не тянуть байты
// всех обращений сразу). label — подпись кнопки и alt. Видео (16.10) — плитка с ▶, на весь
// экран — плеер; isVideo(url) узнает его по ссылке из load (тип — по байтам, feedbackApi).
// indices (fb_37f0c1a8) — показать только эти номера вложений (вложения под своим дополнением);
// без них — все от 0 до count − 1.
export default function FeedbackPhotos({
  id, kind = 'reply', count = 1, indices = null, load, lazy = false, label = 'Скриншот', disabled = false, isVideo = isVideoMedia,
}) {
  const nums = indices ?? Array.from({ length: count }, (_, i) => i)
  const numsKey = nums.join(',')
  const total = nums.length
  const [on, setOn] = useState(!lazy)
  const [urls, setUrls] = useState(() => Array(total).fill(null)) // null — грузится, '' — не вышло
  const [open, setOpen] = useState(null)
  const [closing, setClosing] = useState(false)
  const [direction, setDirection] = useState(null)

  useEffect(() => {
    if (!closing) return undefined
    const timer = setTimeout(() => { setOpen(null); setClosing(false) }, 160)
    return () => clearTimeout(timer)
  }, [closing])

  function close() {
    if (window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) setClosing(true)
    else setOpen(null)
  }

  useEffect(() => {
    const list = numsKey ? numsKey.split(',').map(Number) : []
    if (!on || !list.length) return undefined
    let alive = true
    setUrls(Array(list.length).fill(null))
    list.forEach((n, pos) => {
      Promise.resolve(load(id, kind, n))
        .then((url) => url, () => '')
        .then((url) => { if (alive) setUrls((cur) => cur.map((u, i) => (i === pos ? url : u))) })
    })
    return () => { alive = false }
  }, [on, id, kind, numsKey, load])

  const current = open === null ? null : urls[open]
  const previous = urls.findLastIndex((url, index) => index < open && Boolean(url))
  const next = urls.findIndex((url, index) => index > open && Boolean(url))
  function move(index) {
    if (closing || index < 0) return
    setDirection(index > open ? 'next' : 'previous')
    setOpen(index)
  }

  if (!total) return null
  if (!on) {
    return (
      <button type="button" className="btn ghost fb-attach" onClick={() => setOn(true)} disabled={disabled}>
        <Icon name="clip" size={17} />
        <span>Показать {total > 1 && /^Вложение/.test(label) ? 'вложения' : lowerFirst(label)}</span>
        {total > 1 && <span className="fb-attach-count" aria-label={`Количество: ${total}`}>{total}</span>}
      </button>
    )
  }

  return (
    <>
      <div className="fb-photos">
        {urls.map((url, n) => (
          url === ''
            ? <span key={n} className="fb-photo fb-photo--gone" role="img" aria-label="Картинка недоступна"><Icon name="image" size={22} /></span>
            : url === null
              ? <span key={n} className="fb-photo skel" aria-label="Загрузка" />
              : (
                <button key={n} type="button" className={'fb-photo' + (isVideo(url) ? ' fb-photo--video' : '')}
                  onClick={() => { setDirection(null); setOpen(n) }}
                  aria-label={(total > 1 ? `${mediaLabel(label, isVideo(url))} ${n + 1} из ${total}` : mediaLabel(label, isVideo(url)))}>
                  {isVideo(url) ? <>
                    <video src={videoPosterSrc(url)} muted playsInline preload="metadata" />
                    <span className="fb-video-play"><Icon name="play" size={20} /></span>
                  </> : <img src={url} alt="" />}
                </button>
              )
        ))}
      </div>
      {current && (
        <SheetDialog title={mediaLabel(label, isVideo(current))} onDismiss={close} className={closing ? "fb-viewer fb-viewer--closing" : "fb-viewer"}>
          <SwipeToClose onClose={close} onSlide={(forward) => move(forward ? next : previous)}>
            <div key={open} className={direction ? `fb-slide fb-slide--${direction}` : 'fb-slide'}>
              {isVideo(current)
                ? <video src={current} controls autoPlay playsInline aria-label={mediaLabel(label, true)} />
                : <img src={current} alt={label} />}
            </div>
          </SwipeToClose>
          {total > 1 && <div className="fb-gallery-nav">
            <button type="button" className="btn ghost" aria-label="Предыдущее вложение" disabled={previous < 0}
              onClick={() => move(previous)}><Chevron back /></button>
            <span role="status">{open + 1} из {total}</span>
            <button type="button" className="btn ghost" aria-label="Следующее вложение" disabled={next < 0}
              onClick={() => move(next)}><Chevron /></button>
          </div>}
        </SheetDialog>
      )}
    </>
  )
}

// Подпись по тому, что открыто (26.10.2026): у видео «Скриншот…»/«Вложение…» → «Видео…»; до загрузки
// тип не известен — там общая подпись.
function mediaLabel(label, video) {
  return video ? label.replace(/^(Скриншот|Вложение|Картинка)/, 'Видео') : label
}

// Картинка тянется за пальцем по вертикали; отпустили далеко или резко — закрыть,
// иначе вернуть на место. Один палец; щипок (два пальца) не перехватываем.
function SwipeToClose({ onClose, onSlide, children }) {
  const start = useRef(null)
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)

  function onTouchStart(e) {
    const t = e.touches[0]
    const video = e.target.closest('video')
    const controls = video && t && t.clientY >= video.getBoundingClientRect().bottom - 64
    if (e.touches.length !== 1 || controls) { start.current = null; return }
    start.current = { x: t.clientX, y: t.clientY, at: Date.now(), video: Boolean(video) }
    setDragging(true)
  }
  function onTouchMove(e) {
    if (!start.current || e.touches.length !== 1) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const y = t.clientY - start.current.y
    if (!start.current.video && Math.abs(y) > Math.abs(dx)) setDy(y)
  }
  function onTouchEnd(e) {
    const s = start.current
    start.current = null
    setDragging(false)
    if (!s) return
    const t = e.changedTouches?.[0]
    const dx = t ? t.clientX - s.x : 0
    const y = t ? t.clientY - s.y : dy
    if (!s.video && shouldDismiss({ dx, dy: y, dt: Date.now() - s.at })) onClose()
    else {
      setDy(0)
      if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(y) * 1.5) onSlide(dx < 0)
    }
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

// Строчной — только первая буква: имя автора в подписи остается с заглавной (обращение fb_c9aa4b86).
function lowerFirst(s) {
  return s ? s[0].toLowerCase() + s.slice(1) : s
}
