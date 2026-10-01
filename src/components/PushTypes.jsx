// Тумблеры «какие пуши присылать» (v6.7.0) — под главным переключателем
// «Пуш-уведомления», только когда он включен. Состояние — в hooks/usePushToggle.js.
// prefs: null — еще грузятся (или не загрузились — тогда есть error).
import { PUSH_TYPES, isPushTypeOn } from '../lib/pushSupport.js'

export default function PushTypes({ prefs = null, busyType = null, error = '', onChange }) {
  const loading = prefs === null
  return (
    <div className="push-types" role="group" aria-label="Какие уведомления присылать">
      {PUSH_TYPES.map((t) => {
        const on = !loading && isPushTypeOn(prefs, t.type)
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
  )
}
