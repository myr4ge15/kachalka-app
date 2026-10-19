import { useEffect, useState } from 'react'
import { summarizeReactions, reactorLine } from '../../lib/reactions.js'
import { useLongPress } from '../../hooks/useLongPress.js'

// Реакции под тренировкой (вынесено из FeedScreen в v6.7.1 — теперь и в профиле
// участника). Чужая тренировка — кнопки 💪/🔥/👏/😮 со счетчиками; своя — самолайк
// запрещен: только сводка реакций других без кнопок, нет реакций — ничего.
// Пропсы: reactions, myId, isMe, onReact(kind, mine).
// Удержание реакции (аудит 16.10; облачко — fb_09a0e8d2): пока палец держит реакцию, над рядом
// висит облачко «💪 Борис, Аня» — кто поставил именно ее; отпустил — облачко скрылось. Строка под
// кнопками (все, кто отреагировал) пальцем не закрывается. Тап после удержания реакцию не меняет.
// Подстраховка: если отпускание потерялось, облачко гаснет само.
// comment (19.10.2026, PLAN-comments.md) — { count, mine, onClick }: «💬 N» в конце ряда,
// и на своей, и на чужой тренировке. Нет пропа — ряд как раньше.
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
    <button type="button" className={`reaction-btn cm-pill${comment.mine ? ' mine' : ''}`} onClick={comment.onClick}
      aria-label={comment.count ? `Комментарии: ${comment.count}` : 'Написать комментарий'}>
      <span className="reaction-emoji" aria-hidden="true">💬</span>
      {comment.count > 0 && <span className="reaction-count">{comment.count}</span>}
    </button>
  )
  const line = reactorLine(names)
  const whoLine = line && <div className="muted reaction-who">{line}</div>

  if (isMe) {
    if (total === 0 && !commentBtn) return null
    return (
      <div className="reactions">
        <div className="reaction-btns">
          {bubble}
          {kinds.filter((k) => k.count > 0).map((k) => (
            <span key={k.kind} className="reaction-btn static" {...bind(k.kind)}
              title={`Удержи — кто поставил ${k.emoji}`}>
              <span className="reaction-emoji">{k.emoji}</span>
              <span className="reaction-count">{k.count}</span>
            </span>
          ))}
          {commentBtn}
        </div>
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
        {commentBtn}
      </div>
      {whoLine}
    </div>
  )
}
