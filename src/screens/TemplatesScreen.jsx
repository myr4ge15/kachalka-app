import { useState, useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  getExercises,
  getTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  createExercise,
} from '../db/repo.js'
import { syncNow } from '../db/sync.js'
import ExercisePicker from '../components/ExercisePicker.jsx'

// локальный документ шаблона → редактируемая форма [{ exercise }]
function toItems(tpl) {
  return (tpl?.exercises ?? []).map((e) => ({
    exercise: e.exercise ?? { id: e.exercise_id, name: '—' },
  }))
}

// Экран шаблонов: список ↔ редактор (одно внутреннее состояние editing).
//   editing === null  → список шаблонов
//   editing === 'new' → создание нового
//   editing === <id>  → правка существующего
export default function TemplatesScreen({ user, onBack }) {
  const [editing, setEditing] = useState(null)

  if (editing !== null) {
    return (
      <TemplateEditor
        user={user}
        templateId={editing === 'new' ? null : editing}
        onBack={() => setEditing(null)}
      />
    )
  }

  return <TemplateList user={user} onBack={onBack} onOpen={setEditing} />
}

// Карточка шаблона в списке. mine → бейдж 🌐 у общих; чужой → пометка автора.
function TemplateCard({ t, mine, onOpen }) {
  const exs = t.exercises ?? []
  return (
    <button
      className="card history-card history-tap"
      onClick={() => onOpen(t.id)}
    >
      <div className="history-head">
        <div>
          <div className="history-date">
            {t.name}
            {mine && Boolean(t.is_public) && (
              <span className="tpl-badge" title="Виден всем">🌐 общий</span>
            )}
            {Boolean(t._dirty) && (
              <span className="dot-unsynced" title="Ждёт синхронизации">●</span>
            )}
          </div>
          <div className="muted history-sub">
            {exs.length} упр.
            {!mine && t.author_name && <span className="tpl-author"> · от {t.author_name}</span>}
          </div>
        </div>
        <span className="history-chevron" aria-hidden="true">›</span>
      </div>

      <ul className="history-list">
        {exs.map((e, i) => (
          <li key={i} className="history-ex">
            <span className="history-ex-name">{e.exercise?.name ?? '—'}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}

// ----------------------------- список --------------------------------------
function TemplateList({ user, onBack, onOpen }) {
  const templates = useLiveQuery(() => getTemplates(user.id), [user.id])
  const loading = templates === undefined
  const list = templates ?? []

  const mine = list.filter((t) => t.user_id === user.id)
  const shared = list.filter((t) => t.user_id !== user.id) // чужие общие

  return (
    <div className="screen">
      <div className="detail-head">
        <button className="link-btn back-link" onClick={() => onBack?.()}>← Назад</button>
        <h2 className="screen-title detail-title">Шаблоны</h2>
      </div>

      <button className="btn primary full add-workout" onClick={() => onOpen('new')}>
        + Новый шаблон
      </button>

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && list.length === 0 && (
        <p className="muted empty">Пока нет шаблонов. Создай первый.</p>
      )}

      {!loading && mine.length > 0 && (
        <>
          <h3 className="group-title">Мои шаблоны</h3>
          {mine.map((t) => (
            <TemplateCard key={t.id} t={t} mine onOpen={onOpen} />
          ))}
        </>
      )}

      {!loading && shared.length > 0 && (
        <>
          <h3 className="group-title">Общие</h3>
          {shared.map((t) => (
            <TemplateCard key={t.id} t={t} mine={false} onOpen={onOpen} />
          ))}
        </>
      )}
    </div>
  )
}

// ----------------------------- редактор ------------------------------------
function TemplateEditor({ user, templateId, onBack }) {
  const isNew = templateId == null
  const exercises = useLiveQuery(() => getExercises(), [], [])

  const [name, setName] = useState('')
  const [items, setItems] = useState([])
  const [isPublic, setIsPublic] = useState(false)
  // Чужой общий шаблон открывается в режиме просмотра (read-only): править
  // может только автор. Для нового и своих — false.
  const [readOnly, setReadOnly] = useState(false)
  const [authorName, setAuthorName] = useState(null)
  const [loading, setLoading] = useState(!isNew)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  // Загрузка существующего шаблона на маунте.
  useEffect(() => {
    if (isNew) return
    let alive = true
    setLoading(true)
    getTemplate(templateId).then((t) => {
      if (!alive) return
      if (t) {
        setName(t.name ?? '')
        setItems(toItems(t))
        setIsPublic(Boolean(t.is_public))
        setReadOnly(t.user_id !== user.id)
        setAuthorName(t.author_name ?? null)
      } else {
        setMessage({ type: 'error', text: 'Шаблон не найден.' })
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [isNew, templateId, user.id])

  function addExercise(ex) {
    setPickerOpen(false)
    if (items.some((it) => it.exercise.id === ex.id)) {
      setMessage({ type: 'error', text: 'Это упражнение уже в шаблоне.' })
      return
    }
    setItems([...items, { exercise: ex }])
  }

  function removeExercise(idx) {
    setItems(items.filter((_, i) => i !== idx))
  }

  // ------------------------ drag-n-drop реордер ----------------------------
  // Pointer-события (работают и на тач, в отличие от HTML5 dragstart).
  const rowRefs = useRef([])
  const dragRef = useRef(null) // индекс перетаскиваемого элемента
  const [dragIndex, setDragIndex] = useState(null)

  function move(from, to) {
    setItems((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function onHandleDown(e, idx) {
    e.preventDefault()
    dragRef.current = idx
    setDragIndex(idx)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function onHandleMove(e) {
    if (dragRef.current == null) return
    const y = e.clientY
    // ищем строку, над которой находится палец, — она и есть целевая позиция
    let target = dragRef.current
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (y >= r.top && y <= r.bottom) {
        target = i
        break
      }
    }
    if (target !== dragRef.current) {
      move(dragRef.current, target)
      dragRef.current = target
      setDragIndex(target)
    }
  }

  function onHandleUp(e) {
    dragRef.current = null
    setDragIndex(null)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const canSave = name.trim().length > 0 && items.length > 0 && !saving

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      await saveTemplate({
        id: isNew ? undefined : templateId,
        user_id: user.id,
        name,
        exercises: items,
        is_public: isPublic,
      })
      if (navigator.onLine) syncNow(user.id)
      onBack?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'Не сохранилось: ' + (err.message ?? err) })
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm('Удалить этот шаблон? Действие необратимо.')) return
    setSaving(true)
    setMessage(null)
    try {
      await deleteTemplate(templateId)
      if (navigator.onLine) syncNow(user.id)
      onBack?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'Не удалилось: ' + (err.message ?? err) })
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <div className="detail-head">
        <button className="link-btn back-link" onClick={() => onBack?.()}>← Назад</button>
        <h2 className="screen-title detail-title">
          {isNew ? 'Новый шаблон' : 'Шаблон'}
        </h2>
      </div>

      {message && (
        <div className={message.type === 'error' ? 'banner error' : 'banner ok'}>
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : readOnly ? (
        // Просмотр чужого общего шаблона: без полей ввода и кнопок.
        <>
          <h3 className="tpl-view-name">{name}</h3>
          {authorName && <p className="muted tpl-author">от {authorName}</p>}

          <ul className="history-list">
            {items.map((it, idx) => (
              <li key={idx} className="history-ex">
                <span className="history-ex-name">{it.exercise.name}</span>
              </li>
            ))}
          </ul>
          <p className="muted empty">Чужой общий шаблон — только просмотр. Применить можно при создании тренировки.</p>
        </>
      ) : (
        <>
          <label className="date-field">
            <span className="muted">Название</span>
            <input
              className="search"
              type="text"
              placeholder="Напр. «Понедельник: спина»"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="tpl-toggle">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span>Виден всем</span>
          </label>

          {items.length === 0 && (
            <p className="muted empty">Добавь упражнения в шаблон.</p>
          )}

          {items.map((it, idx) => (
            <div
              key={it.exercise.id}
              ref={(el) => (rowRefs.current[idx] = el)}
              className={dragIndex === idx ? 'tpl-row dragging' : 'tpl-row'}
            >
              <button
                className="tpl-handle"
                aria-label="Перетащить"
                onPointerDown={(e) => onHandleDown(e, idx)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
              >
                ☰
              </button>
              <span className="tpl-name">{it.exercise.name}</span>
              <button className="link-btn danger" onClick={() => removeExercise(idx)}>
                убрать
              </button>
            </div>
          ))}

          <button className="btn outline full" onClick={() => setPickerOpen(true)}>
            + Добавить упражнение
          </button>

          <button className="btn primary full save-btn" disabled={!canSave} onClick={save}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>

          {!isNew && (
            <button className="link-btn danger full-link" disabled={saving} onClick={remove}>
              Удалить шаблон
            </button>
          )}
        </>
      )}

      {pickerOpen && (
        <ExercisePicker
          exercises={exercises}
          onPick={addExercise}
          onCreate={createExercise}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
