import { useState } from 'react'
import Avatar from './Avatar.jsx'

function gapText(rivalry) {
  if (rivalry.tied) return `С ${rivalry.rival.user_name} — один результат`
  if (rivalry.direction === 'below') {
    return `${rivalry.rival.user_name} рядом — разница ${gapValue(rivalry)}`
  }
  return `До ${rivalry.rival.user_name} — ${gapValue(rivalry)}`
}

function gapValue({ gap, gapMetric }) {
  return gapMetric === 'weight' ? `${gap} кг` : `${gap} повт.`
}

function RivalRow({ row, place, isMe, avatarUrl }) {
  return (
    <div className={isMe ? 'rival-detail-row me' : 'rival-detail-row'}>
      <span className="rival-detail-place">{place}</span>
      <Avatar name={row.user_name} url={avatarUrl} className="avatar-sm" />
      <span className="rival-detail-name">{isMe ? 'Ты' : row.user_name}</span>
      <strong>{row.weight} кг</strong>
      <span className="muted">{row.reps} повт.</span>
    </div>
  )
}

// Props-driven карточка: получает только уже разрешённые строки текущего борда.
// При null не рисует заглушку — пустые/загрузочные состояния остаются едиными
// с существующим лидербордом.
export default function RivalryCard({ rivalry, avatarById = new Map() }) {
  const [expanded, setExpanded] = useState(false)
  if (!rivalry) return null

  const detailRows = [
    { row: rivalry.me, place: rivalry.myPlace, isMe: true },
    { row: rivalry.rival, place: rivalry.rivalPlace, isMe: false },
  ].sort((a, b) => a.place - b.place)

  return (
    <section className="card rival-card" aria-label="Ближайший ориентир">
      <button
        type="button"
        className="rival-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="rival-avatars" aria-hidden="true">
          <Avatar
            name={rivalry.me.user_name}
            url={avatarById.get(rivalry.me.user_id)}
            className="avatar-sm"
          />
          <Avatar
            name={rivalry.rival.user_name}
            url={avatarById.get(rivalry.rival.user_id)}
            className="avatar-sm"
          />
        </span>
        <span className="rival-copy">
          <span className="muted rival-kicker">Ближайший ориентир</span>
          <strong>{gapText(rivalry)}</strong>
          <span className="rival-track" aria-hidden="true">
            <span className="rival-progress" style={{ width: `${rivalry.progress}%` }} />
          </span>
        </span>
        <span className="rival-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
      </button>

      {expanded && (
        <div className="rival-details" aria-label="Сравнение результатов">
          {detailRows.map(({ row, place, isMe }) => (
            <RivalRow
              key={row.user_id}
              row={row}
              place={place}
              isMe={isMe}
              avatarUrl={avatarById.get(row.user_id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
