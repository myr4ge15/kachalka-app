import { useState } from 'react'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import TemplateCard from './TemplateCard.jsx'
import MenuRow from '../ui/MenuRow.jsx'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTemplates } from '../../db/repo.js'
import { exerciseMetric, fmtTemplateTarget } from '../../lib/metric.js'
import SheetDialog from '../ui/SheetDialog.jsx'
import Icon from '../ui/Icon.jsx'

function PickItem({ t, mine, onPick }) {
  const [open, setOpen] = useState(false)
  const revealRef = useRevealFocus(open)
  const entries = t.exercises ?? []
  const named = entries.filter(entry => entry.exercise?.name)
  const note = mine && t.is_public
    ? <span className="tpl-badge"><Icon name="globe" size={12} /> виден всем</span>
    : !mine && t.author_name && <span className="tpl-author">от {t.author_name}</span>

  return (
    <div className="tpl-pick-card" ref={revealRef}>
      <TemplateCard t={t} onClick={() => onPick(t)} note={note} />
      {named.length > 0 && <>
        <MenuRow kind="expand" title="Состав" badge={`${entries.length} упр.`} open={open}
          aria-label={`Состав шаблона «${t.name}»`} onClick={() => setOpen(!open)} />
        {open && <ul className="tpl-pick-sub">
          {named.map((entry, i) => (
            <li key={i} className="tpl-pick-line">
              {entry.exercise.name}{' '}
              <span className="tpl-pick-sets">{fmtTemplateTarget(exerciseMetric(entry.exercise), entry)}</span>
            </li>
          ))}
        </ul>}
      </>}
    </div>
  )
}

export default function TemplatePicker({ user, onPick, onClose }) {
  const templates = useLiveQuery(() => getTemplates(user.id), [user.id])
  const loading = templates === undefined
  const list = templates ?? []

  const mine = list.filter((t) => t.user_id === user.id)
  const shared = list.filter((t) => t.user_id !== user.id) // чужие общие

  // Портал в <body>: оверлей на весь вьюпорт, не застревает под шапкой/таббаром.
  // Закрывается свайпом вбок и вниз (fb_d32a9a9c, 27.10.2026): на телефоне лист во весь экран,
  // и палец тянется закрыть его так же, как вложенный экран.
  return (
    <SheetDialog title="Выбрать шаблон" onDismiss={onClose} swipeBack swipeDown>
        <div className="picker-list tpl-picker-list" data-sheet-bounce="">
          {loading && <p className="muted">Загрузка…</p>}

          {!loading && list.length === 0 && (
            <p className="muted">Шаблонов пока нет. Создай в «Тренировки → Шаблоны».</p>
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
    </SheetDialog>
  )
}
