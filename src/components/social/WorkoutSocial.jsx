import { useState } from 'react'
import ReactionBar from './ReactionBar.jsx'
import CommentThread from './CommentThread.jsx'

// Низ карточки тренировки в Ленте и в профиле участника (19.10.2026): реакции + ветка
// комментариев с общим состоянием «раскрыта». 💬 в ряду реакций раскрывает ветку и ставит
// курсор в поле. openThread — раскрыть сразу (пуш о комментарии привел к этой карточке).
// me — { id, name, avatar }.
export default function WorkoutSocial({ workout, me, isMe, onReact, onOpenMember, openThread = false }) {
  const [open, setOpen] = useState(openThread)
  const [focusTick, setFocusTick] = useState(0)
  const comments = workout.comments ?? []
  const comment = {
    count: comments.length,
    mine: comments.some((c) => c.user_id === me.id),
    onClick: () => { setOpen(true); setFocusTick((t) => t + 1) },
  }
  return (
    <>
      <ReactionBar reactions={workout.reactions} myId={me.id} isMe={isMe} onReact={onReact} comment={comment} />
      <CommentThread
        workoutId={workout.id}
        ownerId={workout.user_id}
        comments={comments}
        me={me}
        open={open}
        onOpen={() => setOpen(true)}
        focusTick={focusTick}
        onOpenMember={onOpenMember}
      />
    </>
  )
}
