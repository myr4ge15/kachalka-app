import SheetDialog from '../ui/SheetDialog.jsx'
import { fmtRest, REST_PRESETS, REST_STEP_SEC } from '../../lib/restTimer.js'
import { isIOSDevice } from '../../lib/pushSupport.js'

const R = 94
const C = 2 * Math.PI * R

const SOUND_OPTS = [
  { id: 'off', label: 'Без звука' },
  { id: 'mix', label: 'Поверх музыки' },
  { id: 'loud', label: 'Всегда' },
]
const SOUND_NOTE = {
  off: 'Сигнал — вспышкой кнопки и вибрацией.',
  mix: 'Звучит вместе с музыкой. В беззвучном режиме iPhone промолчит.',
  loud: 'Слышно и в беззвучном режиме, но на iPhone музыка встанет на паузу.',
}

// Лист таймера отдыха (v8.8.0; v8.8.1 — по отзыву владельца): крупное кольцо,
// ±15 с, главная кнопка «Старт / Стоп / Заново», пресеты; настройки сигнала свернуты
// под «Сигнал и экран» (лист был длинным, переключатели наезжали друг на друга),
// там же «Убрать таймер» — выключить совсем. Состояние — hooks/useRestTimer.js.
export default function RestSheet({ state, run, idleSec, settings, exerciseName, onStart, onChoose, onAdjust, onStop, onSettings, onHide, onClose }) {
  const { phase } = state
  const durSec = run ? Math.round(run.durMs / 1000) : idleSec
  const offset = phase === 'run' ? C * state.progress : phase === 'done' ? C : 0
  const big = phase === 'run' ? fmtRest(state.leftMs, { up: true })
    : phase === 'done' ? '0:00' : fmtRest(idleSec * 1000)
  const sub = phase === 'run' ? `из ${fmtRest(durSec * 1000)}`
    : phase === 'done' ? 'пора к подходу' : 'отдых не идет'
  const name = run?.exerciseName ?? exerciseName
  const ios = typeof navigator !== 'undefined' && isIOSDevice(navigator)
  const main = phase === 'run'
    ? { label: 'Стоп', act: onStop, cls: 'rest-btn rest-btn--stop' }
    : { label: phase === 'done' ? 'Заново' : 'Старт', act: () => onStart(), cls: 'rest-btn rest-btn--pri' }

  return (
    <SheetDialog title="Отдых" actionLabel="готово" onDismiss={onClose} swipeDown className="sheet--compact sheet--rest">
      <div className="sheet-scroll rest-sheet">
        {name && <p className="rest-sheet__ctx">{name}</p>}
        <div className={`rest-ring is-${phase}`} role="timer" aria-live="off">
          <svg viewBox="0 0 210 210" width="180" height="180" aria-hidden="true">
            <circle className="rest-ring__track" cx="105" cy="105" r={R} />
            <circle className="rest-ring__arc" cx="105" cy="105" r={R}
              strokeDasharray={C.toFixed(1)} strokeDashoffset={offset.toFixed(1)} />
          </svg>
          <div className="rest-ring__center">
            <span className="rest-ring__big">{big}</span>
            <span className="rest-ring__sub">{sub}</span>
          </div>
        </div>

        <div className="rest-adj">
          <button type="button" className="rest-btn" disabled={phase !== 'run'}
            onClick={() => onAdjust(-REST_STEP_SEC)} aria-label={`Минус ${REST_STEP_SEC} секунд`}>−{REST_STEP_SEC} с</button>
          <button type="button" className={main.cls} onClick={main.act}>{main.label}</button>
          <button type="button" className="rest-btn" disabled={phase !== 'run'}
            onClick={() => onAdjust(REST_STEP_SEC)} aria-label={`Плюс ${REST_STEP_SEC} секунд`}>+{REST_STEP_SEC} с</button>
        </div>

        <div className="rest-presets" role="group" aria-label="Длительность отдыха">
          {REST_PRESETS.map((s) => (
            <button key={s} type="button" aria-pressed={durSec === s} onClick={() => onChoose(s)}>
              {fmtRest(s * 1000)}
            </button>
          ))}
        </div>
        <p className="rest-note">Длительность запоминается для этого упражнения и сразу запускает отдых.</p>

        <details className="rest-more">
          <summary>Сигнал и экран</summary>
          <div className="rest-more__body">
            <div className="seg" role="group" aria-label="Звук">
              {SOUND_OPTS.map((o) => (
                <button key={o.id} type="button" className={'seg-item' + (settings.sound === o.id ? ' on' : '')}
                  aria-pressed={settings.sound === o.id} onClick={() => onSettings({ sound: o.id })}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="rest-note">{SOUND_NOTE[settings.sound]}</p>
            {!ios && (
              <Toggle label="Вибрация" on={settings.vibrate} onToggle={() => onSettings({ vibrate: !settings.vibrate })} />
            )}
            <Toggle label="Не гасить экран" sub="Пока идет отдых" on={settings.wake}
              onToggle={() => onSettings({ wake: !settings.wake })} />
            <Toggle label="Пуш, если свернуто" sub="Нужны включенные уведомления на этом телефоне"
              on={settings.push} onToggle={() => onSettings({ push: !settings.push })} />
            <button type="button" className="rest-hide" onClick={onHide}>Убрать таймер</button>
            <p className="rest-note">Вернуть — Профиль → Настройки → «Таймер отдыха».</p>
          </div>
        </details>
      </div>
    </SheetDialog>
  )
}

function Toggle({ label, sub, on, onToggle }) {
  return (
    <button type="button" className="act toggle-act rest-toggle" role="switch" aria-checked={on} onClick={onToggle}>
      <span className="toggle-act-txt">
        {label}
        {sub && <span className="toggle-act-sub">{sub}</span>}
      </span>
      <span className={'toggle-pill' + (on ? ' on' : '')} aria-hidden="true"><span className="toggle-knob" /></span>
    </button>
  )
}
