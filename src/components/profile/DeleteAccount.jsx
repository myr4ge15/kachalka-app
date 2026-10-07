import { useState } from 'react'
import { deleteMyAccount, LoginError } from '../../lib/auth.js'
import { exportAllMyData } from '../../db/backup.js'
import { APP_VERSION } from '../../lib/appVersion.js'
import { onlyDigits } from '../../lib/text.js'
import { showToast } from '../Toast.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// «Удалить аккаунт» в Настройках (П7 «Мой круг», 07.10.2026; сервер — Edge account-delete,
// supabase/account-delete.sql). Решение владельца: сразу и насовсем, с PIN; перед этим —
// предложить скачать свои данные. Учетку админа так не удалить (сервер ответит 409) —
// админу пункт не показываем.
// onDeleted() — App выходит и стирает следы учетки на устройстве (wipeLocalAccount).
export default function DeleteAccount({ user, onDeleted }) {
  const aliveRef = useAliveRef()
  const [open, setOpen] = useState(false)
  const boxRef = useRevealFocus(open)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('') // '' | 'export' | 'delete'

  if (user.role === 'admin') return null

  function close() { setOpen(false); setPin(''); setErr(''); setBusy('') }

  async function doExport() {
    setBusy('export')
    try {
      const n = await exportAllMyData(user.id, APP_VERSION)
      showToast({ emoji: '💾', title: 'Файл сохранен', sub: `Тренировок в выгрузке: ${n}` })
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось выгрузить', sub: String(e?.message ?? e) })
    } finally {
      if (aliveRef.current) setBusy('')
    }
  }

  async function doDelete() {
    if (pin.length !== 4) { setErr('Введи свой PIN — 4 цифры.'); return }
    setBusy('delete'); setErr('')
    try {
      await deleteMyAccount(user.id, pin)
    } catch (e) {
      if (!aliveRef.current) return
      setBusy(''); setPin('')
      if (e instanceof LoginError && e.code === 'locked' && e.retryAfter) {
        setErr(`Слишком много попыток. Попробуй через ${Math.ceil(e.retryAfter / 60)} мин.`)
      } else {
        setErr(e instanceof LoginError ? e.message : 'Не удалось удалить аккаунт.')
      }
      return
    }
    showToast({ emoji: '👋', title: 'Аккаунт удален', sub: 'Все твои данные стерты.' })
    await onDeleted?.()
  }

  if (!open) {
    return <button className="act danger" onClick={() => setOpen(true)}>⛔ Удалить аккаунт</button>
  }
  return (
    <div className="danger-confirm" ref={boxRef}>
      <p className="danger-text">
        Аккаунт удалится насовсем: тренировки, шаблоны, цели, аватар, реакции, привязка Telegram
        и код восстановления. Вернуть его нельзя, войти снова — тоже.
      </p>
      <p className="muted invite-note">
        Твои упражнения, которые есть в тренировках друзей, останутся у них. Обращения разработчику
        сохранятся без имени.
      </p>
      <button className="btn ghost" type="button" onClick={doExport} disabled={!!busy}>
        {busy === 'export' ? 'Готовлю файл…' : '💾 Сначала скачать мои данные'}
      </button>
      <label className="field">
        <span className="field-lab">PIN для подтверждения</span>
        <input
          className="pin-input" type="password" inputMode="numeric" maxLength={4}
          autoComplete="off" name="del-code" data-lpignore="true" data-1p-ignore placeholder="••••"
          value={pin} disabled={!!busy}
          onChange={(e) => { setPin(onlyDigits(e.target.value).slice(0, 4)); setErr('') }}
        />
      </label>
      {err && <p className="pin-err" role="alert">{err}</p>}
      <div className="danger-actions">
        <button className="btn ghost" type="button" onClick={close} disabled={!!busy}>Отмена</button>
        <button className="btn danger" type="button" onClick={doDelete} disabled={!!busy}>
          {busy === 'delete' ? 'Удаляю…' : 'Удалить навсегда'}
        </button>
      </div>
    </div>
  )
}
