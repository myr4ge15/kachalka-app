import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Avatar from '../ui/Avatar.jsx'
import SheetDialog from '../ui/SheetDialog.jsx'
import { showToast } from '../ui/Toast.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import {
  COMMENT_COUNTER_FROM, COMMENT_MAX, canDeleteComment, cleanBody, commentAgo, previewComments,
} from '../../lib/comments.js'
import { postComment, removeComment } from '../../db/comments.js'

// Ветка комментариев под тренировкой (19.10.2026, PLAN-comments.md; мокап prototypes/comments).
// Свернута — два последних и «Все комментарии (N)»; раскрыта — все по времени и поле внизу.
// Незнакомый автор (сервер: author_known=false) — серая буква и имя без перехода в профиль.
// Отправка оптимистичная: строка сразу (полупрозрачная), ошибка — убрать, вернуть текст, тост.
// Неотправленное не копим: черновик живет в состоянии открытой карточки. Без сети — только чтение.
// Пропсы: workoutId, ownerId, comments, me {id, name}, open, onOpen(), focusTick (растет —
// поставить курсор в поле), onOpenMember(userId).
export default function CommentThread({ workoutId, ownerId, comments, me, open, onOpen, focusTick = 0, onOpenMember }) {
  const online = useOnline()
  const aliveRef = useAliveRef()
  const [text, setText] = useState('')
  const [pending, setPending] = useState([])
  const [asking, setAsking] = useState(null) // комментарий, который спрашиваем удалить
  const [deleting, setDeleting] = useState(false)
  const [reveal, setReveal] = useState(null)
  const boxRef = useRevealFocus(reveal)
  const inputRef = useRef(null)

  // Раскрытие пользователем — карточку в центр; курсор в поле по 💬.
  const lastTick = useRef(focusTick)
  useEffect(() => {
    if (focusTick === lastTick.current) return
    lastTick.current = focusTick
    setReveal({})
    inputRef.current?.focus({ preventScroll: true })
  }, [focusTick])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text, open])

  const all = [...(comments ?? []), ...pending]
  const { shown, hidden } = previewComments(all, open)
  if (!open && all.length === 0) return null

  const body = cleanBody(text)
  const canSend = online && body.length > 0 && body.length <= COMMENT_MAX

  async function send() {
    if (!canSend) return
    const tmp = { id: `tmp-${Date.now()}`, workout_id: workoutId, user_id: me.id, name: me.name || 'Я',
      known: true, avatar_url: me.avatar ?? null, body, created_at: new Date().toISOString(), pending: true }
    setPending((p) => [...p, tmp])
    setText('')
    try {
      await postComment({ userId: me.id, workoutId, ownerId, text: body })
    } catch (e) {
      if (aliveRef.current) setText((cur) => cur || body)
      showToast({ emoji: '⚠️', title: 'Комментарий не отправлен', sub: e?.message })
    } finally {
      if (aliveRef.current) setPending((p) => p.filter((x) => x.id !== tmp.id))
    }
  }

  async function confirmDelete() {
    const c = asking
    setDeleting(true)
    try {
      await removeComment({ userId: me.id, comment: c, ownerId })
      if (aliveRef.current) setAsking(null)
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось удалить', sub: e?.message })
    } finally {
      if (aliveRef.current) setDeleting(false)
    }
  }

  return (
    <div className="cm" ref={boxRef}>
      {shown.map((c) => (
        <div key={c.id} className={`cm-item${c.pending ? ' pending' : ''}`}>
          <Avatar name={c.name} url={c.known ? c.avatar_url : null} className={`avatar-sm${c.known ? '' : ' unknown'}`} />
          <div className="cm-main">
            <div className="cm-head">
              {c.known && onOpenMember && c.user_id
                ? <button type="button" className="cm-name link" onClick={() => onOpenMember(c.user_id)}>{c.name}</button>
                : <span className={`cm-name ${c.known ? 'link' : 'plain'}`}>{c.name}</span>}
              <span className="cm-time">{c.pending ? 'отправка…' : commentAgo(c.created_at)}</span>
            </div>
            <div className="cm-text">{c.body}</div>
          </div>
          {!c.pending && canDeleteComment(c, me.id, ownerId)
            ? <button type="button" className="cm-more-btn" aria-label="Удалить комментарий" onClick={() => setAsking(c)}>⋯</button>
            : <span />}
        </div>
      ))}

      {hidden > 0 && (
        <button type="button" className="cm-all" onClick={() => { onOpen?.(); setReveal({}) }}>
          Все комментарии ({all.length})
        </button>
      )}

      {open && (online ? (
        <>
          <div className="cm-form">
            <textarea
              ref={inputRef}
              className="cm-input"
              rows={1}
              value={text}
              maxLength={COMMENT_MAX + 50}
              placeholder="Написать комментарий"
              aria-label="Комментарий"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="button" className={`cm-send${canSend ? '' : ' off'}`} onClick={send} disabled={!canSend}
              aria-label="Отправить">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></svg>
            </button>
          </div>
          <div className="cm-hint">
            <span>Видят все, кто видит эту тренировку</span>
            {body.length >= COMMENT_COUNTER_FROM && (
              <span className={`cm-count${body.length > COMMENT_MAX ? ' over' : ''}`}>{body.length} / {COMMENT_MAX}</span>
            )}
          </div>
        </>
      ) : (
        <div className="cm-offline" role="status">📡 Нет сети — комментарии только читать</div>
      ))}

      {asking && (
        <SheetDialog title="Удалить комментарий?" actionLabel="отмена" onDismiss={() => setAsking(null)}
          dismissDisabled={deleting} className="sheet--compact">
          <p className="cm-del-quote">
            {asking.user_id === me.id ? 'Твой комментарий' : `Комментарий: ${asking.name}`}
            <br />«{asking.body.length > 80 ? `${asking.body.slice(0, 79)}…` : asking.body}»
          </p>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={() => setAsking(null)} disabled={deleting}>Отмена</button>
            <button type="button" className="btn danger-ghost" onClick={confirmDelete} disabled={deleting} data-autofocus>
              {deleting ? 'Удаляю…' : 'Удалить'}
            </button>
          </div>
        </SheetDialog>
      )}
    </div>
  )
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}
