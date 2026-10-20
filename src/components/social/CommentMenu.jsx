import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { COMMENT_REACTIONS } from '../../lib/comments.js'

// Меню комментария по удержанию (20.10.2026, fb_830c22d6): фон размыт, нажатый пузырь
// поднят над ним на своем месте, под пузырем — меню с иконками (у своего — прижато вправо). Не влезает
// снизу — вся группа сдвигается вверх. Слой кладется в лист ветки (.sheet), иначе — в body.
// Закрывается тапом мимо и Esc (Esc не доходит до листа — тот закрылся бы целиком); фокус — обратно на пузырь.
// Пропсы: anchor — DOM пузыря, itemClass — классы строки (вид пузыря: свой/хвостик), align 'left'|'right',
// actions [{ key, label, icon, danger, disabled, onSelect }], onClose().
// reactions — { mine, onPick(kind) }: полоска реакций НАД пузырем (fb_4cbd8655), выбранная подсвечена; null — без нее
// (свой комментарий, без сети). Пузырь остается на своем месте, полоска встает над ним.
export const MENU_PAD = 12
export const MENU_GAP = 8

export default function CommentMenu({ anchor, itemClass = '', align = 'left', actions, reactions = null, onClose }) {
  const host = anchor?.closest?.('.sheet') ?? document.body
  const bubbleRef = useRef(null)
  const menuRef = useRef(null)
  const stripRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!anchor) return
    const clone = anchor.cloneNode(true)
    clone.removeAttribute('tabindex')
    clone.removeAttribute('aria-haspopup')
    clone.removeAttribute('aria-expanded')
    clone.setAttribute('aria-hidden', 'true')
    clone.setAttribute('inert', '')
    clone.classList.remove('held') // оригинал под слоем спрятан этим классом
    const r = anchor.getBoundingClientRect()
    if (r.width) clone.style.width = `${r.width}px`
    bubbleRef.current?.replaceChildren(clone)
    const hr = host === document.body
      ? { top: 0, left: 0, right: window.innerWidth, height: window.innerHeight }
      : host.getBoundingClientRect()
    // Поля листа — это вырез и полоска «Домой» (safe-area), а с клавиатурой — и она (kb-fit): группа
    // держится внутри них, иначе меню у нижнего пузыря уходило под край экрана (fb_4cbd8655).
    const cs = host === document.body ? null : getComputedStyle(host)
    const padTop = Math.max(MENU_PAD, parseFloat(cs?.paddingTop) || 0)
    const padBottom = Math.max(MENU_PAD, parseFloat(cs?.paddingBottom) || 0)
    const menuH = menuRef.current?.offsetHeight ?? 0
    const strip = stripRef.current ? stripRef.current.offsetHeight + MENU_GAP : 0
    const maxTop = hr.height - padBottom - menuH - MENU_GAP - r.height - strip
    const top = Math.max(padTop, Math.min(r.top - hr.top - strip, maxTop))
    setPos({ top, left: r.left - hr.left, right: hr.right - r.right })
  }, [anchor, host])

  useEffect(() => {
    if (!pos) return
    menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }, [pos])

  useEffect(() => {
    const key = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current?.()
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      if (anchor?.isConnected) anchor.focus({ preventScroll: true })
    }
  }, [anchor])

  const place = pos
    ? { top: pos.top, ...(align === 'right' ? { right: pos.right } : { left: pos.left }) }
    : { top: 0, visibility: 'hidden' }
  return createPortal(
    <div className={`cmm${host === document.body ? ' fixed' : ''}`} data-no-swipe-back
      onClick={(e) => { if (!menuRef.current?.contains(e.target) && !stripRef.current?.contains(e.target)) onClose?.() }}>
      <div className="cmm-scrim" aria-hidden="true" />
      <div className={`cmm-group ${align}`} style={place}>
        {reactions && (
          <div className="cmm-reacts" role="group" aria-label="Реакции" ref={stripRef}>
            {COMMENT_REACTIONS.map((r) => (
              <button key={r.kind} type="button" className={reactions.mine === r.kind ? 'on' : undefined}
                aria-pressed={reactions.mine === r.kind} aria-label={r.label} onClick={() => reactions.onPick?.(r.kind)}>
                {r.emoji}
              </button>
            ))}
          </div>
        )}
        <div className={`cmm-bubble ${itemClass}`} ref={bubbleRef} />
        <div className="cmm-menu" role="menu" aria-label="Действия с комментарием" ref={menuRef}>
          {actions.map((a) => (
            <button key={a.key} type="button" role="menuitem" className={a.danger ? 'danger' : undefined}
              disabled={a.disabled} onClick={() => a.onSelect?.()}>
              <span className="cmm-ico" aria-hidden="true">{ICONS[a.icon]}</span>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    host,
  )
}

const svg = (d) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)
const ICONS = {
  reply: svg(<><path d="M10 6L4 12l6 6" /><path d="M4 12h10a6 6 0 0 1 6 6v1" /></>),
  like: svg(<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />),
  copy: svg(<><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" /></>),
  edit: svg(<><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>),
  delete: svg(<><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6.5 7l1 12.5h9l1-12.5" /><path d="M10 11v5M14 11v5" /></>),
}
