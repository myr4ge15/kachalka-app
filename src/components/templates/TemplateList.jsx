import TemplateCard from './TemplateCard.jsx'
import { useEffect, useState } from 'react'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTemplates } from '../../db/repo.js'
import { exportTemplates } from '../../lib/exportTemplate.js'
import { useExportSelection } from '../../hooks/useExportSelection.js'
import CardsSkeleton from '../ui/CardsSkeleton.jsx'
import ExportBar from '../workout/ExportBar.jsx'
import BackButton from '../ui/BackButton.jsx'
import Chevron from '../ui/Chevron.jsx'
import ScrollTopButton from '../ui/ScrollTopButton.jsx'

// Список шаблонов: «Мои» и «Общие» сворачиваемыми группами, экспорт выбранных в JSON
// (вынесено из screens/TemplatesScreen.jsx, аудит 14.10). Открытие — onOpen(id | 'new').

// Заголовок сворачиваемой группы: тап переключает раскрытие. Строка-карточка, как пункты
// Настроек (.act): название, счетчик таблеткой, шеврон раскрытия справа. Голые строки с
// шевроном слева выбивались из «Спорт-блоков» (26.10.2026, fb_3830b581).
function GroupHeader({ title, count, open, onToggle, btnRef = null }) {
  return (
    <button ref={btnRef} className={'act tpl-group' + (open ? ' is-open' : '')} onClick={onToggle} aria-expanded={open}>
      <span className="tpl-group-title">{title}</span>
      <span className="tpl-group-count">{count}</span>
      <Chevron toggle open={open} className="tpl-group-caret" />
    </button>
  )
}

// ----------------------------- список --------------------------------------
// onSelectModeChange(bool) — включен ли выбор на скачивание (19.10, fb_d9f26797): «+» меню на это
// время утоплена, иначе приподнятый круг перекрывает «Скачать» на баре экспорта (как в «Истории»).
export default function TemplateList({ user, onBack, onOpen, onSelectModeChange }) {
  const templates = useLiveQuery(() => getTemplates(user.id), [user.id])
  const loading = templates === undefined
  const list = templates ?? []

  const mine = list.filter((t) => t.user_id === user.id)
  const shared = list.filter((t) => t.user_id !== user.id) // чужие общие

  // Раскрытость групп: при каждом входе в «Шаблоны» — свернуты (16.10, fb_88be7eab; до того
  // помнилась в localStorage). Возврат из шаблона ее не сбрасывает: список под редактором
  // не размонтируется (TemplatesScreen).
  const [mineOpen, setMineOpen] = useState(false)
  const [sharedOpen, setSharedOpen] = useState(false)
  // Группа, раскрытая тапом, — заголовком к верху экрана (v8.0.1).
  const [revealGroup, setRevealGroup] = useState(null) // { key }
  const groupRevealRef = useRevealFocus(revealGroup, { block: 'start' })
  function toggleMine() {
    setRevealGroup(mineOpen ? null : { key: 'mine' })
    setMineOpen((o) => !o)
  }
  function toggleShared() {
    setRevealGroup(sharedOpen ? null : { key: 'shared' })
    setSharedOpen((o) => !o)
  }

  // Режим экспорта: мультивыбор шаблонов → выгрузка в JSON. Общий хук с «Историей».
  const { selectMode, picked, toggleSelectMode, togglePick, pickAll, exportPicked } =
    useExportSelection(exportTemplates)
  useEffect(() => {
    onSelectModeChange?.(selectMode)
    return () => onSelectModeChange?.(false)
  }, [selectMode, onSelectModeChange])

  const renderCard = (t) => (
    <TemplateCard
      key={t.id}
      t={t}
      onClick={() => selectMode ? togglePick(t.id) : onOpen(t.id)}
      selectMode={selectMode}
      picked={picked.has(t.id)}
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

      {/* Скачивание — наверху, под «+ Новый шаблон» (fb_95f78b7a); стрелка вниз — это и есть
          «скачать файл», поэтому и подпись «Скачать» вместо «Экспорт» (fb_4b633dfb). */}
      <ExportBar
        selectMode={selectMode}
        count={picked.size}
        label="Скачать шаблоны"
        placement="top"
        canShow={!loading && list.length > 0}
        onToggleMode={toggleSelectMode}
        onPickAll={() => pickAll(list)}
        onExport={() => exportPicked(list)}
      />

      {loading && <CardsSkeleton cards={3} />}

      {!loading && list.length === 0 && (
        <p className="muted empty">Пока нет шаблонов. Создай первый.</p>
      )}

      {!loading && mine.length > 0 && (
        <>
          <GroupHeader title="Мои шаблоны" count={mine.length} open={mineOpen} onToggle={toggleMine}
            btnRef={revealGroup?.key === 'mine' ? groupRevealRef : null} />
          {/* В режиме «Скачать» карточки видны и в свернутой группе: иначе выбирать не из чего
              (UI-ревью 23.10). */}
          {(mineOpen || selectMode) && mine.map(renderCard)}
        </>
      )}

      {!loading && shared.length > 0 && (
        <>
          <GroupHeader title="Общие шаблоны" count={shared.length} open={sharedOpen} onToggle={toggleShared}
            btnRef={revealGroup?.key === 'shared' ? groupRevealRef : null} />
          {(sharedOpen || selectMode) && shared.map(renderCard)}
        </>
      )}

      {/* Резерв под бар «Скачать» внизу экрана — после списка, а не под кнопкой (fb_f0dfa756). */}
      {selectMode && <div className="wk-save-spacer" aria-hidden="true" />}
      <ScrollTopButton />
    </div>
  )
}
