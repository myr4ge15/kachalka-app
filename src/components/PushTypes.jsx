// Тумблеры «какие пуши присылать» (v6.7.0). prefs: null — еще грузятся (или не
// загрузились — тогда есть error). Состояние — в hooks/usePushToggle.js.
// v7.1.4: живут на своем экране «Пуш-уведомления» (screens/PushSettingsScreen.jsx)
// одной карточкой со строками через разделитель — без аккордеона и «дерева»
// с отступом, как было в Настройках (v6.12.0–7.1.3).
import { PUSH_TYPES, isPushTypeOn } from '../lib/pushSupport.js'

export default function PushTypes({ prefs = null, busyType = null, error = '', onChange }) {
  const loading = prefs === null
  return (
    <>
      <div className="push-group" role="group" aria-label="Какие уведомления присылать">
        {PUSH_TYPES.map((t) => {
          // Пока настройки грузятся — показываем умолчание («включено», как на
          // сервере), а не «выключено»: иначе тумблеры мигали выкл → вкл (v6.7.1).
          const on = isPushTypeOn(prefs, t.type)
          return (
            <button
              key={t.type}
              type="button"
              className="push-row"
              role="switch"
              aria-checked={on}
              disabled={loading || busyType === t.type}
              onClick={() => onChange?.(t.type, !on)}
            >
              <span aria-hidden="true">{t.emoji}</span>
              <span className="toggle-act-txt">
                {t.label}
                {t.sub && <span className="toggle-act-sub">{t.sub}</span>}
              </span>
              <span className={'toggle-pill' + (on ? ' on' : '')} aria-hidden="true">
                <span className="toggle-knob" />
              </span>
            </button>
          )
        })}
      </div>
      {error && <p className="push-err" role="alert">{error}</p>}
    </>
  )
}
