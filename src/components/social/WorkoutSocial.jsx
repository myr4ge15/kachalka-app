import { useEffect, useRef, useState } from 'react'
import ReactionBar from './ReactionBar.jsx'
import CommentThread from './CommentThread.jsx'
import Avatar from '../ui/Avatar.jsx'
import Chevron from '../ui/Chevron.jsx'
import SheetDialog from '../ui/SheetDialog.jsx'
import { pluralize } from '../../lib/plural.js'

// Низ карточки тренировки в Ленте и в профиле участника: реакции + комментарии.
// 20.10.2026 (fb_152f36fc, «как в Telegram»): вместо двух последних комментариев в карточке —
// одна строка «аватарки комментаторов · N комментариев ›»; тап открывает ветку листом во
// весь экран (все комментарии и поле внизу), закрытие — свайпом назад, как у других листов.
// openThread — открыть ветку сразу (пуш о комментарии привел к этой карточке).
// me — { id, name, avatar }.
export default function WorkoutSocial({ workout, me, isMe, onReact, onOpenMember, openThread = false }) {
  const [open, setOpen] = useState(openThread)
  const [focusTick, setFocusTick] = useState(0)
  const wantFocus = useRef(false)
  const comments = workout.comments ?? []
  function openSheet() {
    wantFocus.current = comments.length === 0 // пусто — сразу писать
    setOpen(true)
  }
  // Курсор — после того как ветка смонтировалась в листе: CommentThread ставит фокус по СМЕНЕ focusTick.
  useEffect(() => {
    if (!open || !wantFocus.current) return
    wantFocus.current = false
    setFocusTick((t) => t + 1)
  }, [open])
  return (
    <>
      <ReactionBar reactions={workout.reactions} myId={me.id} isMe={isMe} onReact={onReact} />
      <CommentStrip comments={comments} onOpen={openSheet} />
      {open && (
        <SheetDialog title="Комментарии" actionLabel="закрыть" onDismiss={() => setOpen(false)} swipeBack className="cm-sheet">
          <div className="sheet-scroll">
            <CommentThread
              workoutId={workout.id}
              ownerId={workout.user_id}
              comments={comments}
              me={me}
              open
              focusTick={focusTick}
              onOpenMember={onOpenMember ? (id) => { setOpen(false); onOpenMember(id) } : undefined}
            />
          </div>
        </SheetDialog>
      )}
    </>
  )
}

// Последние разные комментаторы — до трех кружков, свежий сверху стопки.
export function lastCommenters(comments, max = 3) {
  const out = []
  const seen = new Set()
  for (let i = (comments ?? []).length - 1; i >= 0 && out.length < max; i--) {
    const c = comments[i]
    const key = c.user_id ?? c.name
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

function CommentStrip({ comments, onOpen }) {
  const n = comments.length
  const label = n > 0 ? pluralize(n, 'комментарий', 'комментария', 'комментариев') : 'Оставить комментарий'
  const who = lastCommenters(comments)
  return (
    <button type="button" className="cm-strip" onClick={onOpen} aria-label={label}>
      {who.length > 0 && (
        <span className="cm-strip-avs" aria-hidden="true">
          {who.map((c) => (
            <Avatar key={c.id} name={c.name} url={c.known ? c.avatar_url : null} className={`avatar-sm${c.known ? '' : ' unknown'}`} />
          ))}
        </span>
      )}
      <span className="cm-strip-txt">{label}</span>
      <Chevron className="cm-strip-chev" size={18} />
    </button>
  )
}
