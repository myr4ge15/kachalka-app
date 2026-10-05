import { useEffect, useState } from 'react'
import SheetDialog from './SheetDialog.jsx'

// Картинки обращения из Telegram (v6.12.0): фото ответа разработчика или скриншот
// участника. Хранятся в Telegram, байты отдает Edge `feedback` — load(id, kind, n)
// возвращает object URL (lib/feedbackApi.js feedbackMedia, с кэшем на сессию).
// Тап по превью — картинка на весь экран.
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
          <div className="fb-viewer-body">
            <img src={open} alt={label} />
          </div>
        </SheetDialog>
      )}
    </>
  )
}
