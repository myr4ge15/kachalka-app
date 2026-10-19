import { useEffect, useState } from 'react'
import { summarizeReactions, reactorLine } from '../../lib/reactions.js'
import { useLongPress } from '../../hooks/useLongPress.js'
import { pluralize } from '../../lib/plural.js'

// Реакции под тренировкой (вынесено из FeedScreen в v6.7.1 — теперь и в профиле
// участника). Чужая тренировка — кнопки 💪/🔥/👏/😮 со счетчиками; своя — самолайк
// запрещен: только сводка реакций других без кнопок, нет реакций — ничего.
// Пропсы: reactions, myId, isMe, onReact(kind, mine).
// Удержание реакции (аудит 16.10; облачко — fb_09a0e8d2): пока палец держит реакцию, над рядом
// висит облачко «💪 Борис, Аня» — кто поставил именно ее; отпустил — облачко скрылось. Строка под
// кнопками (все, кто отреагировал) пальцем не закрывается. Тап после удержания реакцию не меняет.
// Подстраховка: если отпускание потерялось, облачко гаснет само.
// comment (19.10.2026, PLAN-comments.md) — { count, mine, onClick }: ссылка «N комментариев» /
// «Комментировать» справа в строке под рядом (слева — кто поставил), и на своей, и на чужой
// тренировке. С 9.5.5 (fb_9e892d66) не таблеткой в ряду — читалась как пятая реакция. Нет пропа —
// как раньше.
const WHO_MS = 6000

export default function ReactionBar({ reactions, myId, isMe, onReact, comment = null }) {
  const { kinds, names, total } = summarizeReactions(reactions, myId)
  const [who, setWho] = useState(null) // { kind, x } — чье облачко и где его хвостик
  const { bind, wasLong } = useLongPress((kind, el) => {
    const row = el?.parentElement
    const x = el && row ? el.getBoundingClientRect().left - row.getBoundingClientRect().left + el.offsetWidth / 2 : 24
    setWho({ kind, x })
  }, { onEnd: () => setWho(null) })
  useEffect(() => {
    if (!who) return undefined
    const t = setTimeout(() => setWho(null), WHO_MS)
    return () => clearTimeout(t)
  }, [who])

  const shown = who ? kinds.find((k) => k.kind === who.kind) : null
  const bubble = shown && (
    <div className="reaction-bubble" role="status" style={{ '--tail-x': who.x + 'px' }}>
      {shown.emoji} {shown.names.length ? shown.names.join(', ') : 'пока никто'}
    </div>
  )
  const commentBtn = comment && (
    <button type="button" className="cm-link" onClick={comment.onClick}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 18.5l1.3-3.9A8 8 0 1 1 8.5 18z" /></svg>
      {comment.count > 0 ? pluralize(comment.count, 'комментарий', 'комментария', 'комментариев') : 'Комментировать'}
    </button>
  )
  const line = reactorLine(names)
  // Строка под рядом: слева кто поставил, справа комментарии.
  const whoLine = (line || commentBtn) && (
    <div className="reaction-foot">
      <span className="muted reaction-who">{line}</span>
      {commentBtn}
    </div>
  )

  if (isMe) {
    if (total === 0 && !commentBtn) return null
    return (
      <div className="reactions">
        {total > 0 && (
          <div className="reaction-btns">
            {bubble}
            {kinds.filter((k) => k.count > 0).map((k) => (
              <span key={k.kind} className="reaction-btn static" {...bind(k.kind)}
                title={`Удержи — кто поставил ${k.emoji}`}>
                <span className="reaction-emoji">{k.emoji}</span>
                <span className="reaction-count">{k.count}</span>
              </span>
            ))}
          </div>
        )}
        {whoLine}
      </div>
    )
  }
  return (
    <div className="reactions">
      <div className="reaction-btns">
        {bubble}
        {kinds.map((k) => (
          <button
            key={k.kind}
            className={`reaction-btn${k.mine ? ' mine' : ''}`}
            {...bind(k.kind)}
            onClick={() => { if (!wasLong()) onReact?.(k.kind, k.mine) }}
            aria-pressed={k.mine}
            title={k.mine ? 'Убрать реакцию (удержи — кто поставил)' : 'Поставить реакцию (удержи — кто поставил)'}
          >
            <span className="reaction-emoji">{k.emoji}</span>
            {k.count > 0 && <span className="reaction-count">{k.count}</span>}
          </button>
        ))}
      </div>
      {whoLine}
    </div>
  )
}
