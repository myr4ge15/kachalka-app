import { useEffect, useState } from 'react'
import { summarizeReactions, reactorLine } from '../../lib/reactions.js'
import { useLongPress } from '../../hooks/useLongPress.js'

// Реакции под тренировкой (вынесено из FeedScreen в v6.7.1 — теперь и в профиле
// участника). Чужая тренировка — кнопки 💪/🔥/👏/😮 со счетчиками; своя — самолайк
// запрещен: только сводка реакций других без кнопок, нет реакций — ничего.
// Пропсы: reactions, myId, isMe, onReact(kind, mine).
// Удержание реакции (аудит 16.10): строка под кнопками на несколько секунд показывает,
// кто поставил именно ее («💪 Борис, Аня»); тап после удержания реакцию не меняет.
const WHO_MS = 4000

export default function ReactionBar({ reactions, myId, isMe, onReact }) {
  const { kinds, names, total } = summarizeReactions(reactions, myId)
  const [who, setWho] = useState(null) // kind, чьи имена показаны
  const { bind, wasLong } = useLongPress((kind) => setWho(kind))
  useEffect(() => {
    if (!who) return undefined
    const t = setTimeout(() => setWho(null), WHO_MS)
    return () => clearTimeout(t)
  }, [who])

  const shown = who ? kinds.find((k) => k.kind === who) : null
  const line = shown
    ? `${shown.emoji} ${shown.names.length ? shown.names.join(', ') : 'пока никто'}`
    : reactorLine(names)
  const whoLine = line && (
    <div className={'muted reaction-who' + (shown ? ' is-detail' : '')} aria-live="polite">{line}</div>
  )

  if (isMe) {
    if (total === 0) return null
    return (
      <div className="reactions">
        <div className="reaction-btns">
          {kinds.filter((k) => k.count > 0).map((k) => (
            <span key={k.kind} className="reaction-btn static" {...bind(k.kind)}
              title={`Удержи — кто поставил ${k.emoji}`}>
              <span className="reaction-emoji">{k.emoji}</span>
              <span className="reaction-count">{k.count}</span>
            </span>
          ))}
        </div>
        {whoLine}
      </div>
    )
  }
  return (
    <div className="reactions">
      <div className="reaction-btns">
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
