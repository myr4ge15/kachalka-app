import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Avatar from './Avatar.jsx'

// Аватар, который можно раскрыть (просьба владельца 07.10, v6.18.0): тап — картинка
// крупно по центру поверх экрана, экран сзади виден, но размыт. Закрыть — тап в любое
// место или Escape. Без картинки (инициал) — обычный Avatar, не кнопка.
export default function AvatarZoom({ name, url, className = 'avatar-lg' }) {
  const [open, setOpen] = useState(false)
  if (!url) return <Avatar name={name} url={url} className={className} />
  const label = `Аватар ${name ?? ''}`.trim()
  return (
    <>
      <button type="button" className="avatar-zoom-btn" onClick={() => setOpen(true)}
        aria-label={`${label} — открыть крупно`}>
        <Avatar name={name} url={url} className={className} />
      </button>
      {open && <AvatarLightbox url={url} name={name} label={label} onClose={() => setOpen(false)} />}
    </>
  )
}

function AvatarLightbox({ url, name, label, onClose }) {
  const boxRef = useRef(null)
  const returnTo = useRef(typeof document !== 'undefined' ? document.activeElement : null)
  useEffect(() => {
    const back = returnTo.current
    boxRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    const root = document.documentElement
    root.dataset.sheetOpen = '1' // фон не прокручивается (как под листами)
    return () => {
      document.removeEventListener('keydown', onKey)
      delete root.dataset.sheetOpen
      if (back instanceof HTMLElement && back.isConnected) back.focus()
    }
  }, [onClose])
  return createPortal(
    <div className="avatar-lightbox" role="dialog" aria-modal="true" aria-label={label}
      tabIndex={-1} ref={boxRef} onClick={onClose}>
      <figure className="avatar-lightbox-fig">
        <img className="avatar-lightbox-img" src={url} alt={label} />
        {name && <figcaption className="avatar-lightbox-name">{name}</figcaption>}
      </figure>
    </div>,
    document.body,
  )
}
