import { useState } from 'react'
import { setMyLogin, LoginError } from '../lib/auth.js'
import { loginProblem } from '../lib/login.js'
import LoginField from '../components/LoginField.jsx'
import AppMark from '../components/AppMark.jsx'
import { useAliveRef } from '../hooks/useAliveRef.js'

// «Придумай логин» (П4 «Мой круг», 07.10.2026) — обязательный шаг для учеток без
// логина. Показывается вместо приложения, только онлайн (hooks/useLoginSetup.js).
// Имя для друзей не меняется; логин нужен только для входа и никому не виден.
export default function LoginSetupScreen({ user, onDone, onLogout }) {
  const aliveRef = useAliveRef()
  const [login, setLogin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const problem = loginProblem(login)
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      const saved = await setMyLogin(user.id, login)
      onDone?.(saved)
    } catch (err) {
      if (!aliveRef.current) return
      setError(err instanceof LoginError ? err.message : 'Не получилось сохранить — попробуй еще раз.')
      setBusy(false)
    }
  }

  return (
    <div className="screen center">
      <div className="card login-card invite-card">
        <AppMark />
        <h1 className="title">Логин для входа</h1>
        <form className="invite-form" onSubmit={submit} noValidate>
          <p className="invite-lead">
            Теперь входим по логину, а не по имени. Придумай его — друзья по-прежнему видят тебя
            как <b>{user?.name}</b>.
          </p>
          <LoginField value={login} disabled={busy} autoFocus
            onChange={(v) => { setLogin(v); setError('') }} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Сохраняю…' : 'Сохранить'}
          </button>
          <p className="muted invite-note">Сменить логин можно потом в Профиле → Настройки.</p>
        </form>
        <div className="login-alt">
          <button className="link-btn" onClick={onLogout} disabled={busy}>Это не я — выйти</button>
        </div>
      </div>
    </div>
  )
}
