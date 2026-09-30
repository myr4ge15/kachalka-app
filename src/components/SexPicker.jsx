// Выбор своего пола в Профиле → Настройки (v6.2.0). Презентационный: значение,
// занятость, ошибка и onChange(next) приходят от ProfileScreen. Пол нужен только
// рейтингу — поэтому подпись объясняет, на что он влияет.
const OPTIONS = [
  { v: 'm', label: 'Мужской' },
  { v: 'f', label: 'Женский' },
  { v: null, label: 'Не указывать' },
]

export default function SexPicker({ value = null, busy = false, error = '', onChange }) {
  return (
    <div className="sex-picker">
      <div className="sex-picker-lab" id="sex-picker-lab">Пол</div>
      <div className="seg" role="radiogroup" aria-labelledby="sex-picker-lab">
        {OPTIONS.map((o) => {
          const on = (value ?? null) === o.v
          return (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={on}
              className={'seg-item' + (on ? ' on' : '')}
              disabled={busy}
              onClick={() => !on && onChange?.(o.v)}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      <p className="sex-picker-sub">
        Для рейтинга: парни соревнуются в жиме лёжа, девушки — в ягодичном мостике.
        «Не указывать» — рейтинг парней.
      </p>
      {error && <p className="sex-picker-err" role="alert">{error}</p>}
    </div>
  )
}
