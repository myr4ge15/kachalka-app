import { useState } from 'react'
import { loginByName } from '../../lib/auth.js'
import { onlyDigits } from '../../lib/text.js'

// Вход по логину + PIN (новое устройство). Только онлайн: хэша учетки тут еще нет.
// П4 (07.10.2026): поле одно — «Логин». Сервер ищет точный логин, а у учеток, где
// логина еще нет, — старое имя (переходный период; потом этот путь выключат).
export default function NameLoginForm({ onLogin, showError, error, setError }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) { setError('Напиши логин.'); return }
    if (pin.length !== 4) { setError('PIN — 4 цифры.'); return }
    if (!navigator.onLine) { setError('Нет сети. Первый вход на устройстве — только онлайн.'); return }
    setBusy(true)
    setError('')
    try {
      const user = await loginByName(name, pin)
      onLogin(user)
    } catch (err) {
      showError(err)
      setPin('')
      setBusy(false)
    }
  }

  return (
    <form className="invite-form" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field-lab" htmlFor="login-name">Логин</label>
        <input id="login-name" className="admin-input" type="text" maxLength={60} autoComplete="username"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="login-hint"
          value={name} disabled={busy} onChange={(e) => { setName(e.target.value); setError('') }} />
        <span className="field-hint" id="login-hint">Еще нет логина — введи свое имя, как раньше.</span>
      </div>
      <label className="field">
        <span className="field-lab">PIN — 4 цифры</span>
        <input className="pin-input" type="password" inputMode="numeric" maxLength={4}
          autoComplete="current-password" placeholder="••••" value={pin} disabled={busy}
          onChange={(e) => { setPin(onlyDigits(e.target.value).slice(0, 4)); setError('') }} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Входим…' : 'Войти'}
      </button>
    </form>
  )
}
