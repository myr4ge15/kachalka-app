import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTemplates } from '../db/repo.js'

// Шит выбора шаблона при создании новой тренировки. onPick(template) →
// родитель (WorkoutScreen) применяет состав к entries. Стиль — как ExercisePicker.
export default function TemplatePicker({ user, onPick, onClose }) {
  const templates = useLiveQuery(() => getTemplates(user.id), [user.id])
  const loading = templates === undefined
  const list = templates ?? []

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

          {list.map((t) => {
            const exs = t.exercises ?? []
            const summary = exs.map((e) => e.exercise?.name).filter(Boolean).join(', ')
            return (
              <button key={t.id} className="picker-item tpl-pick" onClick={() => onPick(t)}>
                <span className="tpl-pick-name">{t.name}</span>
                <span className="picker-group">{exs.length} упр.</span>
                {summary && <span className="tpl-pick-sub muted">{summary}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
