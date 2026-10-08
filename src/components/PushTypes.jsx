import Chevron from './Chevron.jsx'
// Тумблеры «какие пуши присылать» (v6.7.0) — под главным переключателем
// «Пуш-уведомления», только когда он включен. Состояние — в hooks/usePushToggle.js.
// prefs: null — еще грузятся (или не загрузились — тогда есть error).
// v6.12.0: свернуты в одну строку-аккордеон «Какие присылать · N из M» — раскрытый
// список занимал пол-экрана Настроек. Ошибка сохранения видна и в свернутом виде.
import { useState } from 'react'
import { PUSH_TYPES, isPushTypeOn } from '../lib/pushSupport.js'

export default function PushTypes({ prefs = null, busyType = null, error = '', onChange }) {
  const [open, setOpen] = useState(false)
  const loading = prefs === null
  const onCount = PUSH_TYPES.filter((t) => isPushTypeOn(prefs, t.type)).length
  return (
    <>
    <button type="button" className="act push-types-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <span className="toggle-act-txt">
        Какие присылать
        <span className="toggle-act-sub">{loading ? 'загружаю…' : `включено ${onCount} из ${PUSH_TYPES.length}`}</span>
      </span>
      <Chevron className="settings-chev" open={open} />
    </button>
    {!open && error && <p className="push-err" role="alert">{error}</p>}
    {open && (
    <div className="push-types" role="group" aria-label="Какие уведомления присылать">
      {PUSH_TYPES.map((t) => {
        // Пока настройки грузятся — показываем умолчание («включено», как на
        // сервере), а не «выключено»: иначе тумблеры мигали выкл → вкл (v6.7.1).
        const on = isPushTypeOn(prefs, t.type)
        return (
          <button
            key={t.type}
            type="button"
            className="act toggle-act push-type"
            role="switch"
            aria-checked={on}
            disabled={loading || busyType === t.type}
            onClick={() => onChange?.(t.type, !on)}
          >
            <span className="toggle-act-txt">
              <span><span aria-hidden="true">{t.emoji}</span> {t.label}</span>
              {t.sub && <span className="toggle-act-sub">{t.sub}</span>}
            </span>
            <span className={'toggle-pill' + (on ? ' on' : '')} aria-hidden="true">
              <span className="toggle-knob" />
            </span>
          </button>
        )
      })}
      {error && <p className="push-err" role="alert">{error}</p>}
    </div>
    )}
    </>
  )
}
