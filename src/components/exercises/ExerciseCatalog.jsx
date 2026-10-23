import { useMemo, useState } from 'react'
import { splitCatalog, canEditExercise, METRIC_LABEL } from '../../lib/exerciseCatalog.js'
import PencilIcon from '../ui/PencilIcon.jsx'

// Каталог упражнений — ОДИН для участника и Админки (23.10.2026, решение владельца: раньше это были
// два разных модуля). Поиск без учета «ё» и три раздела (lib/exerciseCatalog.js splitCatalog).
// Участник правит только свои (canEditExercise), чужие и базовые — приглушенные строки без реакции.
// В Админке (admin) правится все; скрытые из пикера — в списке с пометкой «скрыто», рядом — быстрое
// «Скрыть»/«Показать». Сохранение и права решает экран (MyExercisesScreen / admin/ExercisesSection).
// Пропсы: list, userId, admin, online, onEdit(ex), onToggleHidden(ex).
export default function ExerciseCatalog({ list, userId, admin = false, online = true, onEdit, onToggleHidden }) {
  const [query, setQuery] = useState('')
  const q = norm(query.trim())
  const shown = useMemo(() => (q ? list.filter((e) => norm(e.name).includes(q)) : list), [list, q])
  const { mine, others, global } = useMemo(() => splitCatalog(shown, userId), [shown, userId])
  const canEdit = (ex) => admin || canEditExercise(ex, userId)
  const row = { admin, online, onEdit, onToggleHidden, canEdit }

  return (
    <>
      <input
        className="search catalog-search"
        type="search"
        placeholder="Поиск упражнения…"
        aria-label="Поиск упражнения"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {q && !shown.length ? (
        <p className="muted catalog-empty">Ничего не найдено.</p>
      ) : (
        <>
          <Section title="Добавлено мной" list={mine} hideEmpty={Boolean(q)} empty="Ты пока не добавлял своих упражнений." {...row} />
          <Section title="Добавлено другими" list={others} hideEmpty={Boolean(q)} empty="Пока никто, кроме тебя." {...row} />
          <Section title="Базовые" list={global} hideEmpty={Boolean(q)} empty="Пусто." {...row} />
        </>
      )}
    </>
  )
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е')

// Раздел. Пустой не прячем — иначе непонятно, куда делось «Добавлено мной», когда своих еще нет;
// при поиске пустые разделы убираем, чтобы найденное не терялось между заголовками.
function Section({ title, list, empty, hideEmpty, ...row }) {
  if (hideEmpty && !list.length) return null
  return (
    <>
      <p className="sec-title catalog-title">{title} <span className="catalog-count">{list.length}</span></p>
      {list.length === 0 ? (
        <p className="muted catalog-empty">{empty}</p>
      ) : (
        <div className="picker-list catalog-list">
          {list.map((ex) => <Row key={ex.id} ex={ex} {...row} />)}
        </div>
      )}
    </>
  )
}

// Строку, которую нельзя править, показываем, но не делаем кнопкой: тап, который открывает форму и
// упирается в ошибку сохранения, хуже честно неактивной строки.
function Row({ ex, admin, online, onEdit, onToggleHidden, canEdit }) {
  const editable = canEdit(ex)
  const body = (
    <span>
      {ex.name}
      <span className="picker-group catalog-meta">
        {METRIC_LABEL[ex.metric] ?? METRIC_LABEL.weight}{admin && ex.is_hidden ? ' · скрыто' : ''}
      </span>
    </span>
  )
  const side = <span className="picker-group">{ex.muscle_group ?? '—'}{editable && <> <PencilIcon size={13} /></>}</span>
  const item = editable
    ? <button type="button" className="picker-item" onClick={() => onEdit(ex)}>{body}{side}</button>
    : <div className="picker-item is-static">{body}{side}</div>
  if (!admin) return item
  return (
    <div className={'catalog-row' + (ex.is_hidden ? ' is-hidden' : '')}>
      {item}
      <button
        type="button" className="admin-mini catalog-hide" disabled={!online} onClick={() => onToggleHidden(ex)}
        aria-label={ex.is_hidden ? `Показать «${ex.name}» в пикере` : `Скрыть «${ex.name}» из пикера`}
      >
        {ex.is_hidden ? '👁' : '🙈'}
      </button>
    </div>
  )
}
