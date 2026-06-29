import { useState, useMemo, useDeferredValue } from 'react'
import { createPortal } from 'react-dom'
import { findSimilar } from '../lib/similar.js'

// Канонические группы мышц из ТЗ (Приложение A / п. 3.2). К ним добавляем
// все группы, реально встретившиеся в справочнике, чтобы ничего не потерять.
const BASE_GROUPS = ['грудь', 'спина', 'ноги', 'плечи', 'бицепс', 'трицепс', 'пресс', 'кардио']

// Подбор упражнения из справочника: поиск по названию + фильтр по группе.
// Если нужного упражнения нет — «+ добавить своё» (ТЗ 3.2 / 4.4): задаём
// название и группу, упражнение сохраняется в общий справочник (onCreate) и
// сразу добавляется в тренировку.
export default function ExercisePicker({ exercises, onPick, onClose, onCreate, title = 'Упражнение' }) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('все')

  // Режим создания своего упражнения.
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [newMetric, setNewMetric] = useState('weight') // weight | reps | time
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const groups = useMemo(() => {
    const set = new Set(exercises.map((e) => e.muscle_group).filter(Boolean))
    return ['все', ...Array.from(set)]
  }, [exercises])

  // Группы, предлагаемые в форме создания: канон из ТЗ + всё, что есть в базе.
  const createGroups = useMemo(() => {
    const set = new Set(BASE_GROUPS)
    for (const e of exercises) if (e.muscle_group) set.add(e.muscle_group)
    return Array.from(set)
  }, [exercises])

  // Поиск и поиск похожих не блокируют ввод: фильтрация идёт по «отложенному»
  // значению (useDeferredValue), пока поле остаётся отзывчивым на каждую букву —
  // фактический debounce без таймеров. Заметно на мобильном и большом справочнике.
  const deferredQuery = useDeferredValue(query)
  const deferredNewName = useDeferredValue(newName)

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return exercises.filter((e) => {
      const okGroup = group === 'все' || e.muscle_group === group
      const okQuery = !q || e.name.toLowerCase().includes(q)
      return okGroup && okQuery
    })
  }, [exercises, deferredQuery, group])

  // Введённого названия нет в справочнике (точного совпадения) → предлагаем
  // создать его прямо из поля. Анти-дубли подтянутся в форме создания (similar).
  const qTrim = deferredQuery.trim()
  const hasExact = useMemo(
    () => !!qTrim && exercises.some((e) => e.name.trim().toLowerCase() === qTrim.toLowerCase()),
    [exercises, qTrim]
  )
  const suggestCreate = !!onCreate && !!qTrim && !hasExact

  // Похожие по названию — чтобы не плодить дубли (ТЗ 3.2 / 4.4). Нечёткое
  // сопоставление (нормализация ё/е, пробелы, порядок слов, опечатки), а не
  // голый includes(), который дубли вроде «жим лёжа»/«жим лежа» пропускает.
  const similar = useMemo(
    () => findSimilar(deferredNewName, exercises, { threshold: 0.45, limit: 5 }),
    [exercises, deferredNewName]
  )

  function openCreate() {
    setNewName(query.trim())
    setNewGroup(group !== 'все' ? group : '')
    setNewMetric('weight')
    setError(null)
    setCreating(true)
  }

  async function submitCreate() {
    const name = newName.trim()
    if (!name) {
      setError('Введите название упражнения.')
      return
    }
    if (!newGroup) {
      setError('Выберите группу мышц.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ex = await onCreate({ name, muscle_group: newGroup, metric: newMetric })
      onPick(ex) // добавляем в тренировку; родитель закроет пикер
    } catch (err) {
      setError('Не удалось сохранить: ' + (err?.message ?? err))
      setBusy(false)
    }
  }

  // -------------------------- форма создания --------------------------------
  // Пикер рендерим порталом в <body>: оверлей position:fixed гарантированно
  // относительно вьюпорта (а не застревает внутри прокручиваемой .content под
  // шапкой/таббаром). Это и есть фикс «модалка не на весь экран».
  if (creating) {
    return createPortal(
      <div className="overlay" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-head">
            <strong>Своё упражнение</strong>
            <button className="link-btn" onClick={() => setCreating(false)}>назад</button>
          </div>

          <input
            className="search"
            placeholder="Название упражнения"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />

          {similar.length > 0 && (
            <div className="create-similar">
              <span className="muted">Возможно, уже есть — нажмите, чтобы выбрать:</span>
              {similar.map((e) => (
                <button key={e.id} className="similar-item" onClick={() => onPick(e)}>
                  <span>{e.name}</span>
                  <span className="picker-group">{e.muscle_group}</span>
                </button>
              ))}
            </div>
          )}

          <div className="create-label">Тип</div>
          <div className="chips">
            <button
              className={newMetric === 'weight' ? 'chip active' : 'chip'}
              onClick={() => setNewMetric('weight')}
            >
              Вес и повторы
            </button>
            <button
              className={newMetric === 'reps' ? 'chip active' : 'chip'}
              onClick={() => setNewMetric('reps')}
            >
              Только повторы
            </button>
            <button
              className={newMetric === 'time' ? 'chip active' : 'chip'}
              onClick={() => setNewMetric('time')}
            >
              На время
            </button>
          </div>

          <div className="create-label">Группа мышц</div>
          <div className="chips">
            {createGroups.map((g) => (
              <button
                key={g}
                className={g === newGroup ? 'chip active' : 'chip'}
                onClick={() => setNewGroup(g)}
              >
                {g}
              </button>
            ))}
          </div>

          {error && <p className="error create-error">{error}</p>}

          <button
            className="btn primary full create-save"
            disabled={busy}
            onClick={submitCreate}
          >
            {busy ? 'Сохранение…' : 'Сохранить и добавить'}
          </button>
        </div>
      </div>,
      document.body
    )
  }

  // ---------------------------- список/поиск --------------------------------
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <strong>{title}</strong>
          <button className="link-btn" onClick={onClose}>закрыть</button>
        </div>

        <input
          className="search"
          placeholder="Поиск по названию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <div className="chips">
          {groups.map((g) => (
            <button
              key={g}
              className={g === group ? 'chip active' : 'chip'}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="picker-list">
          {filtered.map((e) => (
            <button key={e.id} className="picker-item" onClick={() => onPick(e)}>
              <span>{e.name}</span>
              <span className="picker-group">{e.muscle_group}</span>
            </button>
          ))}
          {filtered.length === 0 && !suggestCreate && (
            <p className="muted">Ничего не найдено.</p>
          )}
          {suggestCreate && (
            <button className="picker-item create-suggest" onClick={openCreate}>
              <span>+ Создать «{qTrim}»</span>
              <span className="picker-group">новое</span>
            </button>
          )}
        </div>

        {onCreate && !suggestCreate && (
          <button className="btn outline full create-open" onClick={openCreate}>
            + добавить своё упражнение
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
