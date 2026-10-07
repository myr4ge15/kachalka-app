import { onlyDigits } from '../../lib/text.js'
import { isWeakPin, WEAK_PIN_TEXT } from '../../lib/pinPolicy.js'

// Новый PIN дважды — для сброса по ссылке и по коду (П1).
export function newPinProblem(pin, pin2) {
  if (pin.length !== 4) return 'PIN — 4 цифры.'
  if (pin !== pin2) return 'PIN и повтор не совпадают.'
  if (isWeakPin(pin)) return WEAK_PIN_TEXT
  return ''
}

export default function NewPinFields({ pin, pin2, onPin, onPin2, disabled }) {
  return (
    <>
      <label className="field">
        <span className="field-lab">Новый PIN — 4 цифры</span>
        <input className="pin-input" type="password" inputMode="numeric" maxLength={4}
          autoComplete="new-password" placeholder="••••" value={pin} disabled={disabled}
          onChange={(e) => onPin(onlyDigits(e.target.value).slice(0, 4))} />
      </label>
      <label className="field">
        <span className="field-lab">Новый PIN еще раз</span>
        <input className="pin-input" type="password" inputMode="numeric" maxLength={4}
          autoComplete="new-password" placeholder="••••" value={pin2} disabled={disabled}
          onChange={(e) => onPin2(onlyDigits(e.target.value).slice(0, 4))} />
      </label>
    </>
  )
}
