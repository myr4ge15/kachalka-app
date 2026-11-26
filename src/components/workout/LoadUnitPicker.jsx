import { useState } from 'react'
import Chevron from '../ui/Chevron.jsx'
import CheckIcon from '../ui/CheckIcon.jsx'
import MenuRow from '../ui/MenuRow.jsx'
import SheetDialog from '../ui/SheetDialog.jsx'

const options = [
  ['kg', 'кг', 'Килограммы', 'На шкале указано кг или kg'],
  ['lb', 'lb', 'Фунты', 'На шкале указано lb'],
  ['block', 'Номер блока', 'Номер блока', 'Например, если на плите стоит номер 7, введи 7.'],
]

export default function LoadUnitPicker({ unit, onChange }) {
  const [open, setOpen] = useState(false)
  const label = options.find(o => o[0] === unit)?.[1] ?? 'кг'
  return <>
    <button type="button" className="load-unit" aria-label={`Единица нагрузки: ${label}`}
      aria-haspopup="dialog" onClick={() => setOpen(true)}>{label} <Chevron toggle size={12} /></button>
    {open && <SheetDialog title="Что указано на тренажёре?" onDismiss={() => setOpen(false)}>
      <div className="menu-group">{options.map(([key, , title, sub]) => <MenuRow key={key} kind="action"
        title={title} sub={sub} aria-pressed={key === unit} end={key === unit ? <CheckIcon size={18} /> : null}
        onClick={() => { if (key !== unit) onChange(key); setOpen(false) }} />)}</div>
    </SheetDialog>}
  </>
}
