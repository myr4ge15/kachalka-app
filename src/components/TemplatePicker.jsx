import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTemplates } from '../db/repo.js'

// Шит выбора шаблона при создании новой тренировки. onPick(template) →
// родитель (WorkoutScreen) применяет состав к entries. Стиль — как ExercisePicker.
// Карточка шаблона в пикере. mine → бейдж 🌐 у общих; чужой → пометка автора.
function PickItem({ t, mine, onPick }) {
  const exs = t.exercises ?? []
  const summary = exs.map((e) => e.exercise?.name).filter(Boolean).join(', ')
  return (
    <button className="picker-item tpl-pick" onClick={() => onPick(t)}>
      <span className="tpl-pick-name">
        {t.name}
        {mine && Boolean(t.is_public) && (
          <span className="tpl-badge" title="Виден всему кругу">🌐 общий</span>
        )}
        {!mine && t.author_name && <span className="tpl-author"> · от {t.author_name}</span>}
      </span>
      <span className="picker-group">{exs.length} упр.</span>
      {summary && <span className="tpl-pick-sub muted">{summary}</span>}
    </button>
  )
}

export default function TemplatePicker({ user, onPick, onClose }) {
  const templates = useLiveQuery(() => getTemplates(user.id), [user.id])
  const loading = templates === undefined
  const list = templates ?? []

  const mine = list.filter((t) => t.user_id === user.id)
  const shared = list.filter((t) => t.user_id !== user.id) // чужие общие

  // Портал в <body>: оверлей на весь вьюпорт, не застревает под шапкой/таббаром.
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <strong>Выбрать шаблон</strong>
          <button className="link-btn" onClick={onClose}>закрыть</button>
        </div>

        <div className="picker-list">
          {loading && <p className="muted">Загрузка…</p>}

          {!loading && list.length === 0 && (
            <p className="muted">Шаблонов пока нет. Создай в разделе «Шаблоны».</p>
          )}

          {!loading && mine.length > 0 && (
            <>
              <div className="group-title">Мои</div>
              {mine.map((t) => (
                <PickItem key={t.id} t={t} mine onPick={onPick} />
              ))}
            </>
          )}

          {!loading && shared.length > 0 && (
            <>
              <div className="group-title">Общие</div>
              {shared.map((t) => (
                <PickItem key={t.id} t={t} mine={false} onPick={onPick} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
