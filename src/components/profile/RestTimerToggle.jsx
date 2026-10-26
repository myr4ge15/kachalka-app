import MenuRow from '../ui/MenuRow.jsx'
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
    <MenuRow kind="switch" icon="timer" title="Таймер отдыха" checked={on} onClick={toggle}
      sub="кнопка таймера в упражнении новой тренировки за сегодня" />
  )
}
