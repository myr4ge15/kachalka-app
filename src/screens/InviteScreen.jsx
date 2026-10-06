import { useEffect, useRef, useState } from 'react'
import { checkInvite, registerByInvite, LoginError } from '../lib/auth.js'
import { validateRegistration, inviteDeadText, inviteErrorText, DEAD_STATUSES } from '../lib/invite.js'
import { onlyDigits } from '../lib/text.js'
import SexPicker from '../components/SexPicker.jsx'
import AppMark from '../components/AppMark.jsx'

// Регистрация по ссылке-приглашению (v6.8.0, supabase/invites.sql). Показывается
// вместо экрана входа, пока в App висит токен из адреса (#invite=…).
//
// Пропсы:
//   token            — токен из ссылки;
//   signedInAs       — имя вошедшего на устройстве (или null): ссылка — для НОВОГО
//                      человека, поэтому сначала предлагаем выйти;
//   onRegistered(u)  — учетка создана и сессия поднята → обычный handleLogin;
//   onCancel()       — забыть ссылку и вернуться (к входу или в приложение);
//   onSignOut()      — выйти из текущей учетки, ссылку сохранить.
//
// До регистрации экран не знает и не показывает ничего о круге и его участниках.
export default function InviteScreen({ token, signedInAs = null, onRegistered, onCancel, onSignOut }) {
  // 'checking' | 'form' | 'dead' | 'check-failed' | 'login-failed'
  const [phase, setPhase] = useState('checking')
  const [dead, setDead] = useState('invalid')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [sex, setSex] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [outBusy, setOutBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function check() {
    setPhase('checking')
    try {
      const status = await checkInvite(token)
      if (!alive.current) return
      if (status === 'ok') setPhase('form')
      else { setDead(status); setPhase('dead') }
    } catch {
      if (alive.current) setPhase('check-failed')
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!signedInAs) check() }, [token, signedInAs])

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const problem = validateRegistration({ name, pin, pin2 })
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      const user = await registerByInvite(token, { name: name.trim(), pin, sex })
      onRegistered?.(user)
    } catch (err) {
      if (!alive.current) return
      const code = err instanceof LoginError ? err.code : 'server'
      if (DEAD_STATUSES.has(code)) { setDead(code); setPhase('dead') }
      else if (code === 'registered_login_failed') setPhase('login-failed')
      else setError(inviteErrorText(code))
      if (code === 'name_taken') setPin2('')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  async function signOut() {
    setOutBusy(true)
    try { await onSignOut?.() } finally { if (alive.current) setOutBusy(false) }
  }

  const head = (
    <>
      <AppMark />
      <h1 className="title">Журнал тренировок</h1>
    </>
  )

  let body
  if (signedInAs) {
    body = (
      <>
        <p className="invite-lead">
          Это приглашение для нового участника. Сейчас на устройстве открыта учетка <b>{signedInAs}</b>.
        </p>
        <p className="muted invite-note">Чтобы зарегистрировать нового человека, сначала выйди из нее.</p>
        <div className="invite-actions">
          <button className="btn ghost" onClick={onCancel} disabled={outBusy}>Остаться</button>
          <button className="btn primary" onClick={signOut} disabled={outBusy}>
            {outBusy ? 'Выхожу…' : 'Выйти и продолжить'}
          </button>
        </div>
      </>
    )
  } else if (phase === 'checking') {
    body = (
      <div className="login-busy" role="status">
        <span className="spinner" aria-hidden="true" />
        <span>Проверяю приглашение…</span>
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
  } else if (phase === 'dead') {
    body = (
      <>
        <p className="invite-lead" role="alert">{inviteDeadText(dead)}</p>
        <div className="invite-actions">
          <button className="btn primary" onClick={onCancel}>К входу</button>
        </div>
      </>
    )
  } else if (phase === 'login-failed') {
    body = (
      <>
        <p className="invite-lead" role="alert">{inviteErrorText('registered_login_failed')}</p>
        <div className="invite-actions">
          <button className="btn primary" onClick={onCancel}>К входу</button>
        </div>
      </>
    )
  } else {
    body = (
      <form className="invite-form" onSubmit={submit} noValidate>
        <p className="invite-lead">Тебя пригласили. Придумай, как тебя показывать друзьям, и PIN для входа.</p>
        <label className="field">
          <span className="field-lab">Имя</span>
          <input className="admin-input" type="text" maxLength={40} autoComplete="off"
            value={name} onChange={(e) => { setName(e.target.value); setError('') }} disabled={busy} />
        </label>
        <label className="field">
          <span className="field-lab">PIN — 4 цифры</span>
          <input className="pin-input" type="password" inputMode="numeric" maxLength={4}
            autoComplete="new-password" placeholder="••••"
            value={pin} onChange={(e) => { setPin(onlyDigits(e.target.value).slice(0, 4)); setError('') }} disabled={busy} />
        </label>
        <label className="field">
          <span className="field-lab">PIN еще раз</span>
          <input className="pin-input" type="password" inputMode="numeric" maxLength={4}
            autoComplete="new-password" placeholder="••••"
            value={pin2} onChange={(e) => { setPin2(onlyDigits(e.target.value).slice(0, 4)); setError('') }} disabled={busy} />
        </label>
        <SexPicker value={sex} busy={busy} onChange={setSex} />
        <p className="muted invite-note">Запомни PIN: по нему ты будешь входить. Сменить его можно в Профиле.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Регистрирую…' : 'Зарегистрироваться'}
        </button>
      </form>
    )
  }

  return (
    <div className="screen center">
      <div className="card login-card invite-card">
        {head}
        {body}
      </div>
    </div>
  )
}
