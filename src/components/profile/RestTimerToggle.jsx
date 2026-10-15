import { useState } from 'react'
import { readRestSettings, writeRestSettings } from '../../hooks/useRestTimer.js'
import { cancelRestPush } from '../../db/restPush.js'

// Тумблер «Таймер отдыха» в Настройках Профиля (v8.8.0). Настройка — на устройстве
// (localStorage, как сам таймер): остальные параметры — в листе таймера на экране
// тренировки. Выключение снимает идущий отдых и его пуш.
export default function RestTimerToggle({ userId }) {
  const [on, setOn] = useState(() => readRestSettings(userId).on)
  function toggle() {
    const next = !on
    writeRestSettings(userId, { ...readRestSettings(userId), on: next })
    if (!next) cancelRestPush(userId)
    setOn(next)
  }
  return (
    <button className="act toggle-act" role="switch" aria-checked={on} onClick={toggle}>
      <span className="toggle-act-txt">
        ⏱ Таймер отдыха
        <span className="toggle-act-sub">кнопка рядом с датой новой тренировки за сегодня</span>
      </span>
      <span className={'toggle-pill' + (on ? ' on' : '')} aria-hidden="true">
        <span className="toggle-knob" />
      </span>
    </button>
  )
}
