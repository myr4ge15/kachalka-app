import { useState } from 'react'
import {
  ACCENTS, CUSTOM, applyAccent, isRedZone, loadAccent, saveAccent,
} from '../lib/accent.js'
import BackButton from '../components/BackButton.jsx'
import { setAccentPref } from '../db/repo.js'

// Экран «Оформление» (Профиль → Настройки) — редизайн «Спорт-блоки», этап 1.
// Семь готовых акцентов и «свой оттенок» (ползунок только по оттенку — светлота и
// насыщенность фиксированы в lib/accent.js, поэтому интерфейс не ломается). Выбор
// применяется сразу ко всему приложению, хранится на устройстве (сплэш рисуется
// до входа — public/accent-boot.js) и с v6.2.0 синкается между устройствами
// учётки (род `accent` в user_meta; применение пришедшего — hooks/useAccentSync).
//
// Пропсы: onBack(), [user] — для синка, [storage], [root] — для тестов.
export default function AppearanceScreen({ onBack, user, storage, root }) {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  const docRoot = root ?? (typeof document !== 'undefined' ? document.documentElement : null)
  const [pref, setPref] = useState(() => loadAccent(store))

  const choose = (next) => {
    setPref(next)
    applyAccent(docRoot, next)
    saveAccent(store, next, user?.id ?? null) // с владельцем — см. lib/accent.js loadAccentOwner
    if (user?.id) setAccentPref(user.id, next).catch(() => {})
  }

  const isCustom = pref.id === CUSTOM

  return (
    <div className="screen appearance-screen">
      <div className="admin-head">
        <BackButton onClick={onBack} />
        <h2 className="admin-title">Оформление</h2>
      </div>

      <section className="sec">
        <p className="sec-title">Акцент</p>
        <div className="accent-grid" role="radiogroup" aria-label="Акцентный цвет">
          {ACCENTS.map((a) => {
            const on = pref.id === a.id
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={'accent-tile' + (on ? ' on' : '')}
                onClick={() => choose({ id: a.id, hue: pref.hue })}
              >
                <span className={`accent-sw accent-sw--${a.id}`} aria-hidden="true" />
                {a.name}
              </button>
            )
          })}
          <button
            type="button"
            role="radio"
            aria-checked={isCustom}
            className={'accent-tile' + (isCustom ? ' on' : '')}
            onClick={() => choose({ id: CUSTOM, hue: pref.hue })}
          >
            <span className="accent-sw accent-sw--rainbow" aria-hidden="true" />
            Свой
          </button>
        </div>
      </section>

      <section className="sec">
        <p className="sec-title">Свой цвет</p>
        <div className={'hue-card' + (isCustom ? ' on' : '')}>
          <input
            className="hue-range"
            type="range"
            min="0"
            max="359"
            step="1"
            value={pref.hue}
            aria-label="Оттенок своего цвета"
            onChange={(e) => choose({ id: CUSTOM, hue: Number(e.target.value) })}
          />
          <div className="hue-row">
            {/* Только число оттенка — цвет собирает CSS (.accent-sw--hue), без хардкода в JSX. */}
            <span className="accent-sw accent-sw--hue" style={{ '--sw-hue': pref.hue }} aria-hidden="true" />
            <span className="muted">
              Двигай ползунок — цвет применится сразу. Яркость подбирается сама, чтобы всё читалось.
            </span>
          </div>
          {isCustom && isRedZone(pref.hue) && (
            <p className="hue-warn" role="status">Похож на цвет ошибок и спада — будет путаться</p>
          )}
        </div>
      </section>

      <section className="sec">
        <p className="sec-title">Как это выглядит</p>
        <div className="appearance-preview">
          <button type="button" className="btn primary" tabIndex={-1}>Начать тренировку</button>
          <div className="appearance-preview-row">
            <span className="chip active">Все</span>
            <span className="chip">Грудь</span>
            <span className="appearance-num">7<small> нед.</small></span>
          </div>
        </div>
        <p className="muted appearance-note">
          Фон у всех одинаковый — ночной. Цвет только твой и сохраняется в учётке — будет таким же на всех твоих устройствах.
        </p>
      </section>
    </div>
  )
}
