import { useState } from 'react'
import Avatar from './Avatar.jsx'
import SheetDialog from './SheetDialog.jsx'

// Аватар, который можно раскрыть (просьба владельца 07.10, v6.18.0): тап — лист с
// картинкой крупно, чтобы ее разглядеть. Без картинки (инициал) — обычный Avatar,
// не кнопка: смотреть там нечего.
export default function AvatarZoom({ name, url, className = 'avatar-lg' }) {
  const [open, setOpen] = useState(false)
  if (!url) return <Avatar name={name} url={url} className={className} />
  return (
    <>
      <button type="button" className="avatar-zoom-btn" onClick={() => setOpen(true)}
        aria-label={`Аватар ${name ?? ''}`.trim() + ' — открыть крупно'}>
        <Avatar name={name} url={url} className={className} />
      </button>
      {open && (
        <SheetDialog title={name ?? 'Аватар'} onDismiss={() => setOpen(false)} className="avatar-zoom-sheet">
          <img className="avatar-zoom-img" src={url} alt={`Аватар ${name ?? ''}`.trim()} />
        </SheetDialog>
      )}
    </>
  )
}
