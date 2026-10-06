import { useState } from 'react'
import { setPin, LoginError } from '../../lib/auth.js'
import { onlyDigits } from '../../lib/text.js'
import { isWeakPin, WEAK_PIN_TEXT } from '../../lib/pinPolicy.js'
import { showToast } from '../Toast.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// Смена PIN в Настройках (фаза 2c; вынесено из ProfileScreen в v6.14.1). Свернуто —
// пункт «🔑 Сменить PIN», раскрыто — форма. Закрытие Настроек размонтирует форму,
// поэтому отдельно сбрасывать ее при выходе не нужно.
export default function PinChangeForm({ userId }) {
  const aliveRef = useAliveRef()
  const [pinOpen, setPinOpen] = useState(false)
  // Раскрытая форма смены PIN — в центр экрана (v6.3.5), иначе поля уезжают под клавиатуру/меню.
  const pinFormRef = useRevealFocus(pinOpen)
  const [curPin, setCurPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [rptPin, setRptPin] = useState('')
  const [pinErr, setPinErr] = useState('')
  const [pinBusy, setPinBusy] = useState(false)

  function resetPinForm() {
    setCurPin(''); setNewPin(''); setRptPin(''); setPinErr(''); setPinBusy(false)
  }
  function closePinForm() { setPinOpen(false); resetPinForm() }

  async function submitPin() {
    setPinErr('')
    if (curPin.length !== 4 || newPin.length !== 4 || rptPin.length !== 4) {
      setPinErr('PIN — 4 цифры.'); return
    }
    if (newPin !== rptPin) { setPinErr('Новый PIN и повтор не совпадают.'); return }
    if (newPin === curPin) { setPinErr('Новый PIN совпадает с текущим.'); return }
    if (isWeakPin(newPin)) { setPinErr(WEAK_PIN_TEXT); return }
    setPinBusy(true)
    try {
      await setPin(userId, curPin, newPin)
      if (aliveRef.current) closePinForm()
      showToast({ emoji: '🔑', title: 'PIN обновлен', sub: 'Вход — уже новым PIN.' })
    } catch (e) {
      if (!aliveRef.current) return
      setPinBusy(false)
      setPinErr(e instanceof LoginError ? e.message : 'Не удалось сменить PIN.')
    }
  }

  if (!pinOpen) {
    return <button className="act" onClick={() => setPinOpen(true)}>🔑 Сменить PIN</button>
  }
  return (
    <div className="pin-form" ref={pinFormRef}>
      <p className="pin-form-title">Смена PIN</p>
      <label className="field">
        <span className="field-lab">Текущий PIN</span>
        <input
          className="pin-input" type="password" inputMode="numeric"
          autoComplete="off" name="cur-code" data-lpignore="true" data-1p-ignore
          placeholder="••••"
          value={curPin} onChange={(e) => setCurPin(onlyDigits(e.target.value))}
        />
      </label>
      <label className="field">
        <span className="field-lab">Новый PIN</span>
        <input
          className="pin-input" type="password" inputMode="numeric"
          autoComplete="off" name="new-code" data-lpignore="true" data-1p-ignore
          placeholder="4 цифры"
          value={newPin} onChange={(e) => setNewPin(onlyDigits(e.target.value))}
        />
      </label>
      <label className="field">
        <span className="field-lab">Повтор нового PIN</span>
        <input
          className="pin-input" type="password" inputMode="numeric"
          autoComplete="off" name="rpt-code" data-lpignore="true" data-1p-ignore
          placeholder="еще раз"
          value={rptPin} onChange={(e) => setRptPin(onlyDigits(e.target.value))}
        />
      </label>
      {pinErr && <p className="pin-err" role="alert">{pinErr}</p>}
      <div className="pin-form-actions">
        <button className="btn ghost" onClick={closePinForm} disabled={pinBusy}>Отмена</button>
        <button className="btn primary" onClick={submitPin} disabled={pinBusy}>
          {pinBusy ? 'Сохраняю…' : 'Сменить PIN'}
        </button>
      </div>
    </div>
  )
}
