import { useEffect, useRef, useState } from 'react'
import ReactionBar from './ReactionBar.jsx'
import CommentThread from './CommentThread.jsx'
import Avatar from '../ui/Avatar.jsx'
import Chevron from '../ui/Chevron.jsx'
import SheetDialog from '../ui/SheetDialog.jsx'
import { pluralize } from '../../lib/plural.js'
import { fmtWhen } from '../../lib/dates.js'
import { summarizeReactions } from '../../lib/reactions.js'

// Низ карточки тренировки в Ленте и в профиле участника: реакции + комментарии.
// 20.10.2026 (fb_152f36fc): вместо двух последних комментариев в карточке —
// одна строка «аватарки комментаторов · N комментариев ›»; тап открывает ветку листом во
// весь экран (все комментарии и поле внизу), закрытие — свайпом назад, как у других листов.
// openThread — открыть ветку сразу (пуш о комментарии привел к этой карточке); focusCommentId — на этом
// комментарии (уведомление о комментарии, ответе или реакции на него, fb_2277554b).
// me — { id, name, avatar }; authorAvatar — фото автора тренировки для «поста» над веткой.
// readOnly — только просмотр (режим админа «Видеть всех», 27.10.2026: автор вне круга, сервер действий не примет).
export default function WorkoutSocial({ workout, me, isMe, onReact, onOpenMember, openThread = false, focusCommentId = null, authorAvatar = null, readOnly = false }) {
  const [open, setOpen] = useState(openThread)
  const [focusTick, setFocusTick] = useState(0)
  const [composeHost, setComposeHost] = useState(null) // подвал листа под полем ввода
  const wantFocus = useRef(false)
  const comments = workout.comments ?? []
  function openSheet() {
    wantFocus.current = comments.length === 0 && !readOnly // пусто — сразу писать
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
      <ReactionBar reactions={workout.reactions} myId={me.id} isMe={isMe || readOnly} onReact={onReact} />
      {(!readOnly || comments.length > 0) && <CommentStrip comments={comments} onOpen={openSheet} />}
      {open && (
        <SheetDialog title="Комментарии" actionLabel="закрыть" onDismiss={() => setOpen(false)} swipeBack className="cm-sheet">
          {/* data-sheet-bounce: у края ветка пружинит, как родной список, а не «упирается» (fb_4cbd8655). */}
          <div className="sheet-scroll" data-sheet-bounce="">
            <WorkoutPost workout={workout} avatar={authorAvatar} myId={me.id} />
            <div className="cm-start"><span>{comments.length > 0 ? 'Начало обсуждения' : 'Пока без комментариев'}</span></div>
            <CommentThread
              workoutId={workout.id}
              ownerId={workout.user_id}
              comments={comments}
              me={me}
              open
              focusTick={focusTick}
              onOpenMember={onOpenMember ? (id) => { setOpen(false); onOpenMember(id) } : undefined}
              composeHost={composeHost}
              focusCommentId={focusCommentId}
              readOnly={readOnly}
            />
          </div>
          {/* Поле ввода — вне прокрутки, как в мессенджерах: листается только переписка (fb_ad51c03b, fb_fbbf5381). */}
          <div className="cm-foot" ref={setComposeHost} />
        </SheetDialog>
      )}
    </>
  )
}

// «Пост» над веткой — какую тренировку обсуждаем (fb_830c22d6): чья тренировка, когда,
// сводка и первые упражнения (рекорды — 🏆). Имени нет (профиль участника) — только дата.
export const POST_EXERCISES = 4
export function WorkoutPost({ workout, avatar, myId }) {
  const entries = workout.entries ?? []
  const prs = new Set((workout.prs ?? []).map((p) => p.name))
  const names = entries.slice(0, POST_EXERCISES).map((e) => e.name)
  // Сводка крупными цифрами, как в мокапе (fb_afd6d919); реакции тренировки — таблетками только для чтения.
  const sum = [
    workout.tonnage > 0 && { n: workout.tonnage.toLocaleString('ru-RU'), cap: 'кг тоннаж' },
    workout.exCount != null && { n: workout.exCount, cap: 'упражнений' },
    workout.setCount != null && { n: workout.setCount, cap: 'подходов' },
  ].filter(Boolean)
  const reacts = summarizeReactions(workout.reactions, myId).kinds.filter((k) => k.count > 0)
  return (
    <div className="cm-post">
      <div className="cm-post-top">
        {workout.user_name && <Avatar name={workout.user_name} url={avatar ?? null} className="avatar-sm" />}
        <div className="cm-post-head">
          {workout.user_name && <div className="cm-post-who">{workout.user_name}</div>}
          <div className="cm-post-when">{fmtWhen(workout.performed_at)}</div>
        </div>
      </div>
      {sum.length > 0 && (
        <div className="cm-post-sum">
          {sum.map((x) => <div key={x.cap}><b>{x.n}</b><span>{x.cap}</span></div>)}
        </div>
      )}
      {names.length > 0 && (
        <div className="cm-post-ex">
          {names.map((n, i) => (
            <span key={`${n}-${i}`}>
              {i > 0 && ' · '}
              {prs.has(n) ? <span className="cm-post-pr">🏆 {n}</span> : n}
            </span>
          ))}
          {entries.length > POST_EXERCISES && ' …'}
        </div>
      )}
      {reacts.length > 0 && (
        <div className="cm-post-react" aria-label="Реакции на тренировку">
          {reacts.map((k) => <span key={k.kind} className={k.mine ? 'mine' : undefined}>{k.emoji} {k.count}</span>)}
        </div>
      )}
    </div>
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
