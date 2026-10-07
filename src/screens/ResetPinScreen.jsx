import { useEffect, useRef, useState } from 'react'
import { checkPinReset, applyPinReset, LoginError } from '../lib/auth.js'
import { resetErrorText } from '../lib/recovery.js'
import AppMark from '../components/AppMark.jsx'
import NewPinFields, { newPinProblem } from '../components/recovery/NewPinFields.jsx'

// Новый PIN по ссылке из бота (П1 «Мой круг», 07.10.2026). Как InviteScreen:
// показывается вместо всего, пока в App висит токен из #reset=…
//   token          — токен из ссылки (10 мин, один раз);
//   signedInAs     — имя вошедшего на устройстве или null: ссылка может быть для
//                    другой учетки, поэтому сначала предлагаем выйти;
//   onDone(user)   — PIN сменен, сессия поднята → handleLogin;
//   onCancel()     — забыть ссылку;
//   onSignOut()    — выйти, ссылку сохранить.
export default function ResetPinScreen({ token, signedInAs = null, onDone, onCancel, onSignOut }) {
  const [phase, setPhase] = useState('checking') // 'checking' | 'form' | 'dead' | 'check-failed' | 'login-failed'
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function check() {
    setPhase('checking')
    try {
      const status = await checkPinReset(token)
      if (alive.current) setPhase(status === 'ok' ? 'form' : 'dead')
    } catch {
      if (alive.current) setPhase('check-failed')
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!signedInAs) check() }, [token, signedInAs])

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const p = newPinProblem(pin, pin2)
    if (p) { setError(p); return }
    setBusy(true); setError('')
    try {
      const user = await applyPinReset(token, pin)
      onDone?.(user)
    } catch (err) {
      if (!alive.current) return
      const code = err instanceof LoginError ? err.code : 'server'
      if (code === 'expired') setPhase('dead')
      else if (code === 'reset_login_failed') setPhase('login-failed')
      else setError(resetErrorText(code))
      setBusy(false)
    }
  }

  let body
  if (signedInAs) {
    body = (
      <>
        <p className="invite-lead">Это ссылка для нового PIN. Сейчас на устройстве открыта учетка <b>{signedInAs}</b>.</p>
        <p className="muted invite-note">Если ссылка для другой учетки — сначала выйди из этой.</p>
        <div className="invite-actions">
          <button className="btn ghost" onClick={onCancel}>Остаться</button>
          <button className="btn primary" onClick={() => onSignOut?.()}>Выйти и продолжить</button>
        </div>
      </>
    )
  } else if (phase === 'checking') {
    body = (
      <div className="login-busy" role="status">
        <span className="spinner" aria-hidden="true" />
        <span>Проверяю ссылку…</span>
      </div>
    )
  } else if (phase === 'check-failed') {
    body = (
      <>
        <p className="error" role="alert">Не получилось проверить ссылку — нет связи с сервером.</p>
        <div className="invite-actions">
          <button className="btn ghost" onClick={onCancel}>К входу</button>
          <button className="btn primary" onClick={check}>Еще раз</button>
        </div>
      </>
    )
  } else if (phase === 'dead' || phase === 'login-failed') {
    body = (
      <>
        <p className="invite-lead" role="alert">{resetErrorText(phase === 'dead' ? 'expired' : 'reset_login_failed')}</p>
        <div className="invite-actions">
          <button className="btn primary" onClick={onCancel}>К входу</button>
        </div>
      </>
    )
  } else {
    body = (
      <form className="invite-form" onSubmit={submit} noValidate>
        <p className="invite-lead">Придумай новый PIN. Старый перестанет действовать, а вход на других устройствах — сбросится.</p>
        <NewPinFields pin={pin} pin2={pin2} disabled={busy}
          onPin={(v) => { setPin(v); setError('') }} onPin2={(v) => { setPin2(v); setError('') }} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить PIN и войти'}</button>
      </form>
    )
  }

  return (
    <div className="screen center">
      <div className="card login-card invite-card">
        <AppMark />
        <h1 className="title">Новый PIN</h1>
        {body}
      </div>
    </div>
  )
}
