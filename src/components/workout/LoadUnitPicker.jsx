import Chevron from '../ui/Chevron.jsx'

const options = [
  { value: 'kg', label: 'кг', title: 'Килограммы (кг)' },
  { value: 'lb', label: 'lb', title: 'Фунты (lb)' },
  { value: 'block', label: 'Номер блока', title: 'Номер блока' },
]

export default function LoadUnitPicker({ unit, onChange }) {
  const selected = options.find(option => option.value === unit) ?? options[0]
  return <label className="load-unit">
    <span aria-hidden="true">{selected.label}</span>
    <Chevron toggle size={12} />
    <select aria-label="Единица нагрузки" value={selected.value}
      onPointerDown={event => { event.currentTarget.dataset.pointer = 'true' }}
      onKeyDown={event => { delete event.currentTarget.dataset.pointer }}
      onBlur={event => { delete event.currentTarget.dataset.pointer }}
      onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.title}</option>)}
    </select>
  </label>
}
