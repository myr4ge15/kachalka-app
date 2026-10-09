// Строка «Пуш-уведомления» в Профиле → Настройки (v6.6.0). Состояние браузера
// и подписки — в хуке экрана (hooks/usePushToggle.js); здесь только отрисовка.
// availability: null (еще не узнали) | 'off' | 'ios-install' | 'unsupported' | 'denied' | 'ok'
// — см. lib/pushSupport.js pushAvailability.
import { pushSubtitle } from '../lib/pushSupport.js'

// label (v7.1.4): на своем экране строка называется иначе, чем заголовок экрана.
export default function PushToggle({ availability = null, enabled = false, busy = false, error = '', onToggle, label = '🔔 Пуш-уведомления' }) {
  if (!availability || availability === 'off') return null
  const sub = pushSubtitle(availability)

  if (availability !== 'ok') {
    // Включить отсюда нельзя — только объясняем, что сделать.
    return (
      <div className="act push-act push-act-info">
        <span className="toggle-act-txt">
          {label}
          <span className="toggle-act-sub">{sub}</span>
        </span>
      </div>
    )
  }

  return (
    <>
      {/* v6.7.1: без полупрозрачности и без строки-подзаголовка на время
          переключения — строка не мигает и не меняет высоту. Тумблер уже стоит
          в новом положении (оптимистично), статус — коротко слева от него. */}
      <button
        className="act toggle-act"
        role="switch"
        aria-checked={enabled}
        aria-busy={busy}
        disabled={busy}
        onClick={() => onToggle?.(!enabled)}
      >
        <span className="toggle-act-txt">{label}</span>
        <span className="toggle-act-end">
          {busy && <span className="toggle-act-status">{enabled ? 'Включаю…' : 'Выключаю…'}</span>}
          <span className={'toggle-pill' + (enabled ? ' on' : '') + (busy ? ' pending' : '')} aria-hidden="true">
            <span className="toggle-knob" />
          </span>
        </span>
      </button>
      {error && <p className="push-err" role="alert">{error}</p>}
    </>
  )
}
