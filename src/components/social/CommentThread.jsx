import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Avatar from '../ui/Avatar.jsx'
import CheckIcon from '../ui/CheckIcon.jsx'
import { useSwipeReply } from '../../hooks/useSwipeReply.js'
import { useLongPress } from '../../hooks/useLongPress.js'
import { vibrate } from '../../lib/haptics.js'
import CommentMenu from './CommentMenu.jsx'
import SheetDialog from '../ui/SheetDialog.jsx'
import { showToast } from '../ui/Toast.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { useKeyboardLift } from '../../hooks/useKeyboardLift.js'
import { centerTop, settleScroll } from '../../lib/scrollBox.js'
import {
  COMMENT_COUNTER_FROM, COMMENT_MAX, applyReaction, canDeleteComment, canEditComment, canReactComment, canReplyComment,
  cleanBody, commentClock, commentDayBreaks, commentSeries, isDoubleTap, nameTone, nextReaction, previewComments,
  reactionPills, replyQuote,
} from '../../lib/comments.js'
import { postComment, removeComment, setCommentReaction, updateComment } from '../../db/comments.js'
import Icon from '../ui/Icon.jsx'

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
// 20.10.2026 (fb_830c22d6, мокап prototypes/comments-bubbles.html, вариант B): пузыри —
// свои справа, чужие слева сериями (lib/comments.js commentSeries: цветное имя у первого, аватар у последнего),
// время в углу пузыря, ❤️ — таблеткой под текстом, когда лайки уже есть (первый — пунктом меню). «⋯» и «Ответить»
// убраны: удержание пузыря — меню (CommentMenu: размытый фон, пузырь поверх, Ответить / ❤️ /
// Скопировать / Изменить / Удалить; правый клик и Enter на пузыре — тоже), свайп влево — ответ, как раньше.
// Пропсы: workoutId, ownerId, comments, me {id, name}, open, onOpen(), focusTick (растет —
// поставить курсор в поле), onOpenMember(userId), composeHost — узел вне прокрутки, куда встает поле ввода.
// 26.10.2026 (fb_ad51c03b, fb_fbbf5381): в листе ветки поле — в подвале листа (WorkoutSocial), а не липким
// внутри .sheet-scroll: «пружина» у края уводила его вместе с перепиской, а на фокус iOS докручивала
// прокрутку к месту поля без липкости — переписка уезжала за экран. Портал: состояние и обработчики здесь же.
// focusCommentId — к этому комментарию привело уведомление (fb_2277554b): при открытии он по центру листа и
// коротко подсвечен.
export default function CommentThread({ workoutId, ownerId, comments, me, open, onOpen, focusTick = 0, onOpenMember, composeHost = null, focusCommentId = null }) {
  const online = useOnline()
  const aliveRef = useAliveRef()
  const [text, setText] = useState('')
  const [pending, setPending] = useState([])
  const [menu, setMenu] = useState(null) // { c, el } — меню по удержанию пузыря (CommentMenu)
  const [asking, setAsking] = useState(null) // комментарий, который спрашиваем удалить
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(null) // свой комментарий в правке
  const [replying, setReplying] = useState(null) // комментарий, на который отвечаем
  const [replyTick, setReplyTick] = useState(0) // каждый «Ответить»/свайп — снова курсор в поле (fb_244e1492)
  const [edits, setEdits] = useState({}) // id → текст, пока правка уходит на сервер
  const [likes, setLikes] = useState({}) // id → { reactions, my_reaction, … }, пока реакция уходит на сервер
  const [reveal, setReveal] = useState(null)
  const boxRef = useRevealFocus(reveal)
  const inputRef = useRef(null)
  const formRef = useRef(null)
  // Фокус в поле (тап по 💬, «Изменить», тап по полю) — поле с кнопкой над клавиатурой (fb_9e892d66).
  const liftAboveKeyboard = useKeyboardLift(formRef)
  // Свайп влево по комментарию — ответить (20.10.2026); кнопка «Ответить» остается.
  const swipe = useSwipeReply((c) => startReply(c))
  // Удержание пузыря — меню (hooks/useLongPress, как у реакций). Правый клик и системное удержание Android
  // (contextmenu) — тоже меню; оба могут прийти на одно удержание — меню ставим, а не переключаем.
  function openMenu(c, el) {
    if (!el) return
    setMenu((m) => {
      if (m?.c.id === c.id) return m
      vibrate()
      return { c, el }
    })
  }
  const { bind: holdBind, wasLong } = useLongPress((c, el) => openMenu(c, el))
  // Двойной тап по чужому пузырю — ❤️ (fb_afd6d919). Тап после удержания (открыл меню) не считаем.
  const lastTap = useRef(null)
  function tapBubble(e, c) {
    if (wasLong() || e.target.closest('button, a')) { lastTap.current = null; return }
    const t = Date.now()
    if (isDoubleTap(lastTap.current, c.id, t)) {
      lastTap.current = null
      if (online && canReactComment(c, me.id)) { vibrate(); react(c, nextReaction(c, 'heart')) }
      return
    }
    lastTap.current = { id: c.id, t }
  }
  const hold = (c) => ({ ...holdBind(c), onContextMenu: (e) => { e.preventDefault(); openMenu(c, e.currentTarget) } })

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

  // Привело уведомление — комментарий по центру прокрутки листа. Один раз на монтирование ветки (новый переход
  // перемонтирует ее, FeedScreen key); settleScroll, а не scrollIntoView: на iPhone тот пропускается.
  const focusedOnce = useRef(false)
  const hasFocusComment = (comments ?? []).some((c) => c.id === focusCommentId)
  useEffect(() => {
    if (!open || !hasFocusComment || focusedOnce.current) return
    const el = boxRef.current?.querySelector(`[data-cm="${CSS.escape(String(focusCommentId))}"]`)
    const sc = el?.closest('.sheet-scroll')
    if (!sc) return
    focusedOnce.current = true
    return settleScroll(sc, centerTop(sc, el))
  }, [open, hasFocusComment, focusCommentId, boxRef])

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

  // Реакция (fb_4cbd8655): kind — вид или null (снять); одна от человека, новая заменяет прежнюю.
  async function react(c, kind) {
    if (!online) return
    setLikes((m) => ({ ...m, [c.id]: applyReaction(c, kind) }))
    try {
      await setCommentReaction({ userId: me.id, comment: c, ownerId, kind })
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

  async function copy(c) {
    setMenu(null)
    try {
      await navigator.clipboard.writeText(c.body)
      showToast({ emoji: '📋', title: 'Скопировано' })
    } catch {
      showToast({ emoji: '⚠️', title: 'Не получилось скопировать' })
    }
  }

  // С клавиатуры: Enter / пробел / клавиша меню на пузыре — то же меню.
  function keyBubble(e, c) {
    if (e.target !== e.currentTarget || !['Enter', ' ', 'ContextMenu'].includes(e.key)) return
    e.preventDefault()
    openMenu(c, e.currentTarget)
  }

  const series = commentSeries(shown)
  const days = commentDayBreaks(shown)
  // Вид пузыря в меню — как в ветке (свой/чужой, хвостик у последнего в серии).
  function menuItemClass(c) {
    const i = shown.findIndex((x) => x.id === c.id)
    const s = series[i] ?? { first: true, last: true }
    return `cm-item${c.user_id === me.id ? ' own' : ''}${s.first ? ' first' : ''}${s.last ? ' last' : ''}`
  }
  function menuActions(c) {
    const out = []
    if (online && canReplyComment(c, me.id)) out.push({ key: 'reply', icon: 'reply', label: 'Ответить', onSelect: () => startReply(c) })
    out.push({ key: 'copy', icon: 'copy', label: 'Скопировать', onSelect: () => copy(c) })
    if (canEditComment(c, me.id)) out.push({ key: 'edit', icon: 'edit', label: 'Изменить', disabled: !online, onSelect: () => startEdit(c) })
    if (canDeleteComment(c, me.id, ownerId)) {
      out.push({ key: 'delete', icon: 'delete', label: 'Удалить', danger: true, onSelect: () => { setMenu(null); setAsking(c) } })
    }
    return out
  }
  const compose = open && (online ? (
    // Блок ввода — одним узлом: в листе ветки (WorkoutSocial) он в подвале листа, под перепиской.
    <div className="cm-compose">
      {editing && (
        <div className="cm-editing">
          <span>Изменяешь комментарий</span>
          <button type="button" onClick={cancelEdit} aria-label="Отменить правку"><Icon name="close" size={16} /></button>
        </div>
      )}
      {replying && (
        <div className="cm-editing">
          <span>Ответ: {replying.name}</span>
          <button type="button" onClick={() => setReplying(null)} aria-label="Отменить ответ"><Icon name="close" size={16} /></button>
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
  ))

  return (
    <div className="cm" ref={boxRef}>
      {shown.map((c, i) => {
        const own = c.user_id === me.id
        const { first, last } = series[i]
        const quote = replyQuote(c, all)
        const canReply = !c.pending && online && canReplyComment(c, me.id)
        const canReact = canReactComment(c, me.id)
        // Таблетки реакций под текстом (fb_4cbd8655): «эмодзи число», своя подсвечена; тап — поставить/снять этот вид.
        const pills = c.pending ? [] : reactionPills(c)
        const likeBtn = pills.length > 0 && pills.map((p) => (
          <button key={p.kind} type="button" className={`cm-like${p.mine ? ' on' : ''}`}
            onClick={() => react(c, nextReaction(c, p.kind))}
            disabled={!canReact || !online} aria-pressed={canReact ? p.mine : undefined}
            aria-label={canReact ? `${p.label}: ${p.count}${p.mine ? ', убрать' : ''}` : `${p.label}: ${p.count}`}>
            <span className="cm-like-emo" aria-hidden="true">{p.emoji}</span>
            <span>{p.count}</span>
          </button>
        ))
        const edited = !c.pending && c.edited_at
        const time = c.pending ? 'отправка…' : commentClock(c.created_at)
        const metaText = `${edited ? 'изм. ' : ''}${time}`
        const meta = (
          <span className="cm-meta">
            {edited && <span className="cm-edited" title="изменено">изм.</span>}
            <span className="cm-time">{time}</span>
          </span>
        )
        const tone = c.known ? ` link t${nameTone(c.user_id ?? c.name)}` : ' plain'
        return (
          <Fragment key={c.id}>
          {days[i] && <div className="cm-day"><span>{days[i]}</span></div>}
          <div className={`cm-item${own ? ' own' : ''}${first ? ' first' : ''}${last ? ' last' : ''}${c.pending ? ' pending' : ''}${c.id === focusCommentId ? ' cm-item--focus' : ''}`}
            data-cm={c.id} {...swipe(c, canReply)}>
            {canReply && (
              <span className="cm-swipe-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"><path d="M10 7l-5 5 5 5" /><path d="M5 12h9a5 5 0 0 1 5 5v1" /></svg>
              </span>
            )}
            {!own && (last
              ? <Avatar name={c.name} url={c.known ? c.avatar_url : null} className={`avatar-sm${c.known ? '' : ' unknown'}`} />
              : <span className="cm-av-gap" aria-hidden="true" />)}
            <div className={`cm-bub${menu?.c.id === c.id ? ' held' : ''}`}
              tabIndex={c.pending ? undefined : 0} aria-haspopup={c.pending ? undefined : 'menu'}
              aria-expanded={c.pending ? undefined : menu?.c.id === c.id}
              onKeyDown={(e) => keyBubble(e, c)} onClick={(e) => tapBubble(e, c)} {...(c.pending ? {} : hold(c))}>
              {!own && first && (c.known && onOpenMember && c.user_id
                ? <button type="button" className={`cm-name${tone}`} onClick={() => onOpenMember(c.user_id)}>{c.name}</button>
                : <span className={`cm-name${tone}`}>{c.name}</span>)}
              {quote && (
                <div className="cm-quote">
                  <span className="cm-quote-name">{quote.name}</span>
                  {quote.text && <span className="cm-quote-text">{quote.text}</span>}
                </div>
              )}
              {/* Время — справа на последней строке текста (место держит ::after по длине подписи), а при
                  реакциях — справа в ряду таблеток. */}
              <span className={`cm-text${likeBtn ? '' : ' with-meta'}`} style={likeBtn ? undefined : { '--meta-ch': metaText.length }}>
                {c.body}
              </span>
              {likeBtn
                ? <div className="cm-reacts">{likeBtn}{meta}</div>
                : meta}
            </div>
          </div>
          </Fragment>
        )
      })}

      {hidden > 0 && (
        <button type="button" className="cm-all" onClick={() => { onOpen?.(); setReveal({}) }}>
          Все комментарии ({all.length})
        </button>
      )}

      {composeHost ? compose && createPortal(compose, composeHost) : compose}

      {menu && (
        <CommentMenu anchor={menu.el} itemClass={menuItemClass(menu.c)} align={menu.c.user_id === me.id ? 'right' : 'left'}
          actions={menuActions(menu.c)} onClose={() => setMenu(null)}
          reactions={online && canReactComment(menu.c, me.id)
            ? { mine: menu.c.my_reaction, onPick: (kind) => { const c = menu.c; setMenu(null); react(c, nextReaction(c, kind)) } }
            : null} />
      )}

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
