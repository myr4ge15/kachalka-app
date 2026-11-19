import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Avatar from './Avatar.jsx'

// Аватар, который можно раскрыть (просьба владельца 07.10, v6.18.0): тап — картинка
// крупно по центру поверх экрана, экран сзади виден, но размыт. Закрыть — тап в любое
// место или Escape. Без картинки (инициал) — обычный Avatar, не кнопка.
export default function AvatarZoom({ name, url, className = 'avatar-lg', online = false }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  if (!url) return <Avatar name={name} url={url} className={className} online={online} />
  const label = `Аватар ${name ?? ''}`.trim()
  return (
    <>
      <button type="button" ref={triggerRef} className="avatar-zoom-btn" onClick={() => setOpen(true)}
        aria-label={`${label} — открыть крупно`}>
        <Avatar name={name} url={url} className={className} online={online} />
      </button>
      {open && <AvatarLightbox url={url} name={name} label={label} triggerRef={triggerRef} onClose={() => setOpen(false)} />}
    </>
  )
}

function AvatarLightbox({ url, name, label, triggerRef, onClose }) {
  const boxRef = useRef(null)
  useLayoutEffect(() => {
    const back = triggerRef.current
    const dialog = boxRef.current
    dialog.showModal()
    const root = document.documentElement
    const previous = root.dataset.sheetOpen
    root.dataset.sheetOpen = '1' // фон не прокручивается (как под листами)
    return () => {
      dialog.close()
      if (previous === undefined) delete root.dataset.sheetOpen
      else root.dataset.sheetOpen = previous
      if (back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [triggerRef])
  return createPortal(
    <dialog className="avatar-lightbox" aria-label={label} ref={boxRef} onClick={onClose}
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <button type="button" className="avatar-lightbox-fig" aria-label="Закрыть фото">
        <img className="avatar-lightbox-img" src={url} alt={label} draggable={false} />
        {name && <span className="avatar-lightbox-name">{name}</span>}
      </button>
    </dialog>,
    document.body,
  )
}
