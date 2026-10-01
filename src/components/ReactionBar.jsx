import { summarizeReactions, reactorLine } from '../lib/reactions.js'

// Реакции под тренировкой (вынесено из FeedScreen в v6.7.1 — теперь и в профиле
// участника). Чужая тренировка — кнопки 💪/🔥/👏/😮 со счетчиками; своя — самолайк
// запрещен: только сводка реакций других без кнопок, нет реакций — ничего.
// Пропсы: reactions, myId, isMe, onReact(kind, mine).
export default function ReactionBar({ reactions, myId, isMe, onReact }) {
  const { kinds, names, total } = summarizeReactions(reactions, myId)
  const line = reactorLine(names)
  if (isMe) {
    if (total === 0) return null
    return (
      <div className="reactions">
        <div className="reaction-btns">
          {kinds.filter((k) => k.count > 0).map((k) => (
            <span key={k.kind} className="reaction-btn static">
              <span className="reaction-emoji">{k.emoji}</span>
              <span className="reaction-count">{k.count}</span>
            </span>
          ))}
        </div>
        {line && <div className="muted reaction-who">{line}</div>}
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
            onClick={() => onReact?.(k.kind, k.mine)}
            aria-pressed={k.mine}
            title={k.mine ? 'Убрать реакцию' : 'Поставить реакцию'}
          >
            <span className="reaction-emoji">{k.emoji}</span>
            {k.count > 0 && <span className="reaction-count">{k.count}</span>}
          </button>
        ))}
      </div>
      {line && <div className="muted reaction-who">{line}</div>}
    </div>
  )
}
