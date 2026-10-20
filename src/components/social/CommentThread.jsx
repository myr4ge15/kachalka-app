import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Avatar from '../ui/Avatar.jsx'
import CheckIcon from '../ui/CheckIcon.jsx'
import { useSwipeReply } from '../../hooks/useSwipeReply.js'
import MoreMenu from '../ui/MoreMenu.jsx'
import SheetDialog from '../ui/SheetDialog.jsx'
import { showToast } from '../ui/Toast.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { useKeyboardLift } from '../../hooks/useKeyboardLift.js'
import {
  COMMENT_COUNTER_FROM, COMMENT_MAX, canDeleteComment, canEditComment, canLikeComment, canReplyComment, cleanBody,
  commentAgo, previewComments, replyQuote, toggleLike,
} from '../../lib/comments.js'
import { postComment, removeComment, setCommentLike, updateComment } from '../../db/comments.js'

// Ветка комментариев под тренировкой (19.10.2026, PLAN-comments.md; мокап prototypes/comments).
// Свернута — два последних и «Все комментарии (N)»; раскрыта — все по времени и поле внизу.
// Незнакомый автор (сервер: author_known=false) — серая буква и имя без перехода в профиль.
// Отправка оптимистичная: строка сразу (полупрозрачная), ошибка — убрать, вернуть текст, тост.
// Неотправленное не копим: черновик живет в состоянии открытой карточки. Без сети — только чтение.
// 9.5.3: «⋯» у своего — «Изменить / Удалить» (правка — в том же поле, полоска «Изменяешь…»,
// у строки метка «изменено»); у чужого под своей тренировкой — сразу «Удалить?». ❤️ справа
// в строке: на чужой — кнопка, на своем — только счетчик. Правка и ❤️ тоже оптимистичные.
// 9.5.4: «⋯» — выпадающее меню (ui/MoreMenu), не лист снизу; у чужого под своей тренировкой — только «Удалить».
// Ответ (20261019235000_comment_reply.sql): «Ответить» под чужим — полоска «Ответ: Имя ✕» над полем, ветка
// остается плоской по времени, у ответа — цитата исходного (имя + начало текста). Адресату — пуш «ответил тебе».
// Пропсы: workoutId, ownerId, comments, me {id, name}, open, onOpen(), focusTick (растет —
// поставить курсор в поле), onOpenMember(userId).
export default function CommentThread({ workoutId, ownerId, comments, me, open, onOpen, focusTick = 0, onOpenMember }) {
  const online = useOnline()
  const aliveRef = useAliveRef()
  const [text, setText] = useState('')
  const [pending, setPending] = useState([])
  const [menu, setMenu] = useState(null) // комментарий, у которого открыто меню «⋯»
  const [asking, setAsking] = useState(null) // комментарий, который спрашиваем удалить
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(null) // свой комментарий в правке
  const [replying, setReplying] = useState(null) // комментарий, на который отвечаем
  const [replyTick, setReplyTick] = useState(0) // каждый «Ответить»/свайп — снова курсор в поле (fb_244e1492)
  const [edits, setEdits] = useState({}) // id → текст, пока правка уходит на сервер
  const [likes, setLikes] = useState({}) // id → { like_count, liked }, пока ❤️ уходит на сервер
  const [reveal, setReveal] = useState(null)
  const boxRef = useRevealFocus(reveal)
  const inputRef = useRef(null)
  const formRef = useRef(null)
  // Фокус в поле (тап по 💬, «Изменить», тап по полю) — поле с кнопкой над клавиатурой (fb_9e892d66).
  const liftAboveKeyboard = useKeyboardLift(formRef)
  // Свайп влево по комментарию — ответить (20.10.2026, как в Telegram); кнопка «Ответить» остается.
  const swipe = useSwipeReply((c) => startReply(c))

  // Раскрытие пользователем — карточку в центр; курсор в поле по «Комментировать» (ReactionBar).
  // Ветка уже была раскрыта — только курсор, без центрирования: повторный тап двигал экран (fb_5ef64577;
  // AGENTS: reveal — только на фактическую смену раскрытого).
  const lastTick = useRef(focusTick)
  const wasOpen = useRef(open)
  useEffect(() => {
    const opened = !wasOpen.current && open
    wasOpen.current = open
    if (focusTick === lastTick.current) return
    lastTick.current = focusTick
    if (opened) setReveal({})
    inputRef.current?.focus({ preventScroll: true })
  }, [focusTick, open])

  // Начали править — поле уже с текстом (ветка раскрылась), курсор в конец.
  useEffect(() => {
    if (!editing || !open) return
    const el = inputRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange?.(el.value.length, el.value.length)
  }, [editing, open])

  // Нажали «Ответить» — курсор в поле (ветка уже раскрыта или раскрывается сейчас). По replyTick,
  // а не по replying: повторный свайп при уже выбранном адресате тоже открывает клавиатуру.
  useEffect(() => {
    if (!replying || !open) return
    inputRef.current?.focus({ preventScroll: true })
  }, [replyTick, replying, open])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text, open])

  const all = [...(comments ?? []), ...pending].map((c) => {
    let x = c
    if (edits[c.id] != null) x = { ...x, body: edits[c.id], edited_at: x.edited_at ?? 'pending' }
    if (likes[c.id]) x = { ...x, ...likes[c.id] }
    return x
  })
  const { shown, hidden } = previewComments(all, open)
  if (!open && all.length === 0) return null

  const body = cleanBody(text)
  const canSend = online && body.length > 0 && body.length <= COMMENT_MAX

  async function send() {
    if (!canSend) return
    if (editing) return saveEdit()
    const replyTo = replying
    const tmp = { id: `tmp-${Date.now()}`, workout_id: workoutId, user_id: me.id, name: me.name || 'Я',
      known: true, avatar_url: me.avatar ?? null, body, created_at: new Date().toISOString(), pending: true,
      reply_to: replyTo?.id ?? null, reply_to_user: replyTo?.user_id ?? null, reply_to_name: replyTo?.name ?? null }
    setPending((p) => [...p, tmp])
    setText('')
    setReplying(null)
    try {
      await postComment({ userId: me.id, workoutId, ownerId, text: body, replyTo })
    } catch (e) {
      if (aliveRef.current) {
        setText((cur) => cur || body)
        setReplying((cur) => cur ?? replyTo)
      }
      showToast({ emoji: '⚠️', title: 'Комментарий не отправлен', sub: e?.message })
    } finally {
      if (aliveRef.current) setPending((p) => p.filter((x) => x.id !== tmp.id))
    }
  }

  async function saveEdit() {
    const c = editing
    setEditing(null)
    setText('')
    if (body === c.body) return // ничего не поменялось — не трогаем сервер и метку
    setEdits((m) => ({ ...m, [c.id]: body }))
    try {
      await updateComment({ userId: me.id, comment: c, ownerId, text: body })
    } catch (e) {
      if (aliveRef.current) { setEditing(c); setText((cur) => cur || body) }
      showToast({ emoji: '⚠️', title: 'Не удалось изменить', sub: e?.message })
    } finally {
      if (aliveRef.current) setEdits((m) => { const n = { ...m }; delete n[c.id]; return n })
    }
  }

  function startReply(c) {
    setMenu(null)
    if (editing) { setEditing(null); setText('') }
    setReplying(c)
    setReplyTick((n) => n + 1)
    if (!open) { onOpen?.(); setReveal({}) }
  }

  function startEdit(c) {
    setMenu(null)
    setReplying(null)
    setEditing(c)
    setText(c.body)
    if (!open) onOpen?.()
    setReveal({})
  }

  function cancelEdit() {
    setEditing(null)
    setText('')
  }

  async function like(c) {
    if (!online) return
    const on = !c.liked
    setLikes((m) => ({ ...m, [c.id]: toggleLike(c, on) }))
    try {
      await setCommentLike({ userId: me.id, comment: c, ownerId, on })
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не получилось', sub: e?.message })
    } finally {
      if (aliveRef.current) setLikes((m) => { const n = { ...m }; delete n[c.id]; return n })
    }
  }

  async function confirmDelete() {
    const c = asking
    setDeleting(true)
    try {
      await removeComment({ userId: me.id, comment: c, ownerId })
      if (aliveRef.current) {
        setAsking(null)
        if (editing?.id === c.id) cancelEdit()
        if (replying?.id === c.id) setReplying(null)
      }
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось удалить', sub: e?.message })
    } finally {
      if (aliveRef.current) setDeleting(false)
    }
  }

  return (
    <div className="cm" ref={boxRef}>
      {shown.map((c) => {
        const mine = canEditComment(c, me.id)
        const quote = replyQuote(c, all)
        const canReply = !c.pending && online && canReplyComment(c, me.id)
        const canLike = canLikeComment(c, me.id)
        const more = !c.pending && (mine || canDeleteComment(c, me.id, ownerId))
        const likeBtn = !c.pending && (canLike || c.like_count > 0) && (
          <button type="button" className={`cm-like${c.liked ? ' on' : ''}`} onClick={() => like(c)}
            disabled={!canLike || !online} aria-pressed={canLike ? c.liked : undefined}
            aria-label={canLike ? (c.liked ? 'Убрать лайк' : 'Лайк') : `Лайков: ${c.like_count}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
            </svg>
            {c.like_count > 0 && <span>{c.like_count}</span>}
          </button>
        )
        return (
          <div key={c.id} className={`cm-item${c.pending ? ' pending' : ''}`} {...swipe(c, canReply)}>
            {canReply && (
              <span className="cm-swipe-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"><path d="M10 7l-5 5 5 5" /><path d="M5 12h9a5 5 0 0 1 5 5v1" /></svg>
              </span>
            )}
            <Avatar name={c.name} url={c.known ? c.avatar_url : null} className={`avatar-sm${c.known ? '' : ' unknown'}`} />
            <div className="cm-main">
              <div className="cm-head">
                {c.known && onOpenMember && c.user_id
                  ? <button type="button" className="cm-name link" onClick={() => onOpenMember(c.user_id)}>{c.name}</button>
                  : <span className={`cm-name ${c.known ? 'link' : 'plain'}`}>{c.name}</span>}
                <span className="cm-time">{c.pending ? 'отправка…' : commentAgo(c.created_at)}</span>
                {!c.pending && c.edited_at && <span className="cm-edited">· изменено</span>}
              </div>
              {quote && (
                <div className="cm-quote">
                  <span className="cm-quote-name">{quote.name}</span>
                  {quote.text && <span className="cm-quote-text">{quote.text}</span>}
                </div>
              )}
              <div className="cm-text">{c.body}</div>
              {canReply && (
                <button type="button" className="cm-reply-btn" onClick={() => startReply(c)} aria-label={`Ответить: ${c.name}`}>
                  Ответить
                </button>
              )}
            </div>
            {likeBtn || more
              ? (
                <div className="cm-acts">
                  {likeBtn}
                  {more && (
                    <MoreMenu label="Действия с комментарием" btnClassName="cm-more-btn" open={menu?.id === c.id}
                      onToggle={() => setMenu((m) => (m?.id === c.id ? null : c))} onClose={() => setMenu(null)}>
                      {mine && <button type="button" role="menuitem" onClick={() => startEdit(c)} disabled={!online}>Изменить</button>}
                      <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); setAsking(c) }}>
                        Удалить
                      </button>
                    </MoreMenu>
                  )}
                </div>
              )
              : <span />}
          </div>
        )
      })}

      {hidden > 0 && (
        <button type="button" className="cm-all" onClick={() => { onOpen?.(); setReveal({}) }}>
          Все комментарии ({all.length})
        </button>
      )}

      {open && (online ? (
        // Блок ввода — одним узлом: в листе ветки (WorkoutSocial) он прижат к низу экрана (fb_7b5cda99).
        <div className="cm-compose">
          {editing && (
            <div className="cm-editing">
              <span>Изменяешь комментарий</span>
              <button type="button" onClick={cancelEdit} aria-label="Отменить правку">✕</button>
            </div>
          )}
          {replying && (
            <div className="cm-editing">
              <span>Ответ: {replying.name}</span>
              <button type="button" onClick={() => setReplying(null)} aria-label="Отменить ответ">✕</button>
            </div>
          )}
          <div className="cm-form" ref={formRef}>
            {/* key по подсказке: iOS не перерисовывает ширину смененного placeholder — после ответа
                оставалось «Написать комм» (fb_244e1492). Текст в состоянии, фокус вернет эффект ответа. */}
            <textarea
              key={replying ? 'reply' : 'comment'}
              ref={inputRef}
              className="cm-input"
              rows={1}
              value={text}
              maxLength={COMMENT_MAX + 50}
              placeholder={replying ? 'Написать ответ' : 'Написать комментарий'}
              aria-label="Комментарий"
              onChange={(e) => setText(e.target.value)}
              onFocus={liftAboveKeyboard}
            />
            <button type="button" className={`cm-send${canSend ? '' : ' off'}`} onClick={send} disabled={!canSend}
              aria-label={editing ? 'Сохранить' : 'Отправить'}>
              {editing
                ? <CheckIcon size={20} />
                : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></svg>}
            </button>
          </div>
          {/* Подпись «Видят все, кто видит эту тренировку» убрана (20.10.2026, просьба владельца) —
              строка только со счетчиком знаков, когда до предела близко. */}
          {body.length >= COMMENT_COUNTER_FROM && (
            <div className="cm-hint">
              <span className={`cm-count${body.length > COMMENT_MAX ? ' over' : ''}`}>{body.length} / {COMMENT_MAX}</span>
            </div>
          )}
        </div>
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
