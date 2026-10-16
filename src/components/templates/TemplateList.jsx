import { useState } from 'react'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTemplates } from '../../db/repo.js'
import { exerciseMetric, fmtTemplateTarget } from '../../lib/metric.js'
import { exportTemplates } from '../../lib/exportTemplate.js'
import { useExportSelection } from '../../hooks/useExportSelection.js'
import CardsSkeleton from '../ui/CardsSkeleton.jsx'
import ExportBar from '../workout/ExportBar.jsx'
import BackButton from '../ui/BackButton.jsx'

// Список шаблонов: «Мои» и «Общие» сворачиваемыми группами, экспорт выбранных в JSON
// (вынесено из screens/TemplatesScreen.jsx, аудит 14.10). Открытие — onOpen(id | 'new').

// Карточка шаблона в списке. mine → бейдж 🌐 у общих; чужой → пометка автора.
// В режиме экспорта (selectMode) тап переключает галочку вместо открытия.
function TemplateCard({ t, mine, onOpen, selectMode = false, picked = false, onPick }) {
  const exs = t.exercises ?? []
  return (
    <button
      className={
        'card history-card history-tap tpl-card' + (selectMode && picked ? ' picked' : '')
      }
      onClick={() => (selectMode ? onPick?.(t.id) : onOpen(t.id))}
    >
      <div className="history-head">
        <div>
          <div className="history-date">
            {t.name}
            {mine && Boolean(t.is_public) && (
              <span className="tpl-badge" title="Виден всем">🌐 общий</span>
            )}
            {Boolean(t._dirty) && (
              <span className="dot-unsynced" title="Ждет синхронизации">●</span>
            )}
          </div>
          <div className="muted history-sub">
            {exs.length} упр.
            {!mine && t.author_name && <span className="tpl-author"> · от {t.author_name}</span>}
          </div>
        </div>
        {selectMode ? (
          <span className={'history-check' + (picked ? ' on' : '')} aria-hidden="true">
            {picked ? '✓' : ''}
          </span>
        ) : (
          <span className="history-chevron" aria-hidden="true">›</span>
        )}
      </div>

      <ul className="history-list">
        {exs.map((e, i) => {
          const target = fmtTemplateTarget(exerciseMetric(e.exercise), e)
          return (
            <li key={i} className="history-ex">
              <span className="history-ex-name">{e.exercise?.name ?? '—'}</span>
              {target && <span className="history-ex-sets">{target}</span>}
            </li>
          )
        })}
      </ul>
    </button>
  )
}

// Свернутость групп списка запоминаем между заходами (localStorage, синхронно).
// Дефолт — свернуто; ключ на пользователя, чтобы не смешивать состояние учеток.
function readGroupOpen(userId, key, dflt = false) {
  try {
    const v = localStorage.getItem(`tpl_group_${key}_${userId}`)
    return v == null ? dflt : v === '1'
  } catch { return dflt }
}
function writeGroupOpen(userId, key, open) {
  try { localStorage.setItem(`tpl_group_${key}_${userId}`, open ? '1' : '0') } catch { /* приватный режим */ }
}

// Заголовок сворачиваемой группы: тап переключает раскрытие, стрелка ▸/▾ + счетчик.
function GroupHeader({ title, count, open, onToggle, btnRef = null }) {
  return (
    <button ref={btnRef} className="group-title group-toggle" onClick={onToggle} aria-expanded={open}>
      <span className="group-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      <span className="group-toggle-title">{title}</span>
      <span className="group-count muted">{count}</span>
    </button>
  )
}

// ----------------------------- список --------------------------------------
export default function TemplateList({ user, onBack, onOpen }) {
  const templates = useLiveQuery(() => getTemplates(user.id), [user.id])
  const loading = templates === undefined
  const list = templates ?? []

  const mine = list.filter((t) => t.user_id === user.id)
  const shared = list.filter((t) => t.user_id !== user.id) // чужие общие

  // Раскрытость групп (по умолчанию свернуты, состояние помним в localStorage).
  const [mineOpen, setMineOpen] = useState(() => readGroupOpen(user.id, 'mine'))
  const [sharedOpen, setSharedOpen] = useState(() => readGroupOpen(user.id, 'shared'))
  // Группа, раскрытая тапом, — заголовком к верху экрана (v8.0.1). Сохраненное
  // раскрытие при входе экран не двигает: триггер ставит только нажатие.
  const [revealGroup, setRevealGroup] = useState(null) // { key }
  const groupRevealRef = useRevealFocus(revealGroup, { block: 'start' })
  function toggleMine() {
    setRevealGroup(mineOpen ? null : { key: 'mine' })
    setMineOpen((o) => { writeGroupOpen(user.id, 'mine', !o); return !o })
  }
  function toggleShared() {
    setRevealGroup(sharedOpen ? null : { key: 'shared' })
    setSharedOpen((o) => { writeGroupOpen(user.id, 'shared', !o); return !o })
  }

  // Режим экспорта: мультивыбор шаблонов → выгрузка в JSON. Общий хук с «Историей».
  const { selectMode, picked, toggleSelectMode, togglePick, pickAll, exportPicked } =
    useExportSelection(exportTemplates)

  const renderCard = (t, isMine) => (
    <TemplateCard
      key={t.id}
      t={t}
      mine={isMine}
      onOpen={onOpen}
      selectMode={selectMode}
      picked={picked.has(t.id)}
      onPick={togglePick}
    />
  )

  return (
    <div className="screen">
      <div className="detail-head">
        <BackButton onClick={() => onBack?.()} />
        <h2 className="screen-title detail-title">Шаблоны</h2>
      </div>

      {!selectMode && (
        <button className="btn primary full add-workout" onClick={() => onOpen('new')}>
          + Новый шаблон
        </button>
      )}

      {loading && <CardsSkeleton cards={3} />}

      {!loading && list.length === 0 && (
        <p className="muted empty">Пока нет шаблонов. Создай первый.</p>
      )}

      {!loading && mine.length > 0 && (
        <>
          <GroupHeader title="Мои шаблоны" count={mine.length} open={mineOpen} onToggle={toggleMine}
            btnRef={revealGroup?.key === 'mine' ? groupRevealRef : null} />
          {mineOpen && mine.map((t) => renderCard(t, true))}
        </>
      )}

      {!loading && shared.length > 0 && (
        <>
          <GroupHeader title="Общие" count={shared.length} open={sharedOpen} onToggle={toggleShared}
            btnRef={revealGroup?.key === 'shared' ? groupRevealRef : null} />
          {sharedOpen && shared.map((t) => renderCard(t, false))}
        </>
      )}

      {/* Экспорт — общий ExportBar (как в «Истории»). */}
      <ExportBar
        selectMode={selectMode}
        count={picked.size}
        label="Экспорт шаблонов"
        canShow={!loading && list.length > 0}
        onToggleMode={toggleSelectMode}
        onPickAll={() => pickAll(list)}
        onExport={() => exportPicked(list)}
      />
    </div>
  )
}
