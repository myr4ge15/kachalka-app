// Выбор своего пола в Профиле → Настройки (v6.2.0). Презентационный: значение,
// занятость, ошибка и onChange(next) приходят от ProfileScreen. Пол нужен для
// обращения в правильном роде и (позже) для рейтинга. Обещание «раздельный рейтинг
// скоро» убрано в v6.5.0: женского борда на проде нет до задачи «Дисциплины рейтинга».
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
      {error && <p className="sex-picker-err" role="alert">{error}</p>}
    </div>
  )
}
