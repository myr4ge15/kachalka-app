import { useCallback, useEffect, useRef, useState } from 'react'
import { checkInvite, checkCircleCode, checkLoginForInvite, registerByInvite, createRecoveryCode, LoginError } from '../lib/auth.js'
import { joinStatusText } from '../lib/friendCircles.js'
import RecoveryCodeView from '../components/recovery/RecoveryCodeView.jsx'
import { normalizeLogin } from '../lib/login.js'
import LoginField from '../components/LoginField.jsx'
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
//
// «Мой круг» (07.10.2026): вместо token — code (личный код из ссылки #join=…). Тогда
// превью «Сега зовет в круг «Зал»» (имя пригласившего и круга — больше ничего), та же
// форма, после регистрации человек сразу в круге (вошедшего на устройстве App сразу
// ведет в «Мой круг», сюда он не попадает).
export default function InviteScreen({ token = null, code = null, signedInAs = null, onRegistered, onCancel, onSignOut }) {
  const ref = code ? { code } : token
  const [preview, setPreview] = useState(null) // { circle_name, inviter_name }
  // 'checking' | 'form' | 'dead' | 'check-failed' | 'login-failed' | 'code'
  const [phase, setPhase] = useState('checking')
  const [dead, setDead] = useState('invalid')
  const [name, setName] = useState('')
  // Логин для входа (П4, 07.10.2026) — первым полем, из имени НЕ подставляется
  // (решение владельца 07.10): человек придумывает его сам.
  const [login, setLogin] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [sex, setSex] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [outBusy, setOutBusy] = useState(false)
  // Код восстановления (П1, v6.18.0) — сразу после регистрации, один раз.
  const [fresh, setFresh] = useState(null) // { user, code }
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function check() {
    setPhase('checking')
    try {
      let status
      if (code) {
        const p = await checkCircleCode(code)
        status = p.status
        if (alive.current && status === 'ok') setPreview(p)
      } else {
        status = await checkInvite(token)
      }
      if (!alive.current) return
      if (status === 'ok') setPhase('form')
      else { setDead(status); setPhase('dead') }
    } catch {
      if (alive.current) setPhase('check-failed')
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!signedInAs) check() }, [token, code, signedInAs])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkLogin = useCallback((v) => checkLoginForInvite(ref, v), [token, code])

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const problem = validateRegistration({ name, login, pin, pin2 })
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      const user = await registerByInvite(ref, { name: name.trim(), pin, sex, login: normalizeLogin(login) })
      // Не вышло выпустить код — не держим человека: получит в Профиле → Настройки.
      let code = null
      try { code = await createRecoveryCode(user.id) } catch { /* позже в Профиле */ }
      if (code && alive.current) { setFresh({ user, code }); setPhase('code'); return }
      onRegistered?.(user)
    } catch (err) {
      if (!alive.current) return
      const errCode = err instanceof LoginError ? err.code : 'server'
      if (DEAD_STATUSES.has(errCode)) { setDead(errCode); setPhase('dead') }
      else if (errCode === 'registered_login_failed') setPhase('login-failed')
      else setError(inviteErrorText(errCode))
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
        <p className="invite-lead" role="alert">{code ? joinStatusText(dead) : inviteDeadText(dead)}</p>
        <div className="invite-actions">
          <button className="btn primary" onClick={onCancel}>К входу</button>
        </div>
      </>
    )
  } else if (phase === 'code' && fresh) {
    body = (
      <>
        <p className="invite-lead">Готово, учетка создана 🎉 Последний шаг — код на случай, если забудешь PIN.</p>
        <RecoveryCodeView code={fresh.code} doneLabel="Сохранил, дальше" onDone={() => onRegistered?.(fresh.user)} />
        <p className="muted invite-note">Еще можно привязать Telegram: Профиль → Настройки → Восстановление доступа.</p>
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
        {preview ? (
          <p className="invite-lead"><b>{preview.inviter_name}</b> зовет тебя в круг <b>«{preview.circle_name}»</b>. Придумай логин и PIN для входа и имя, которое увидят друзья.</p>
        ) : (
          <p className="invite-lead">Тебя пригласили. Придумай логин и PIN для входа и имя, которое увидят друзья.</p>
        )}
        <LoginField value={login} check={checkLogin} disabled={busy}
          onChange={(v) => { setLogin(v); setError('') }} />
        <label className="field">
          <span className="field-lab">Имя (как тебя увидят)</span>
          <input className="admin-input" type="text" maxLength={30} autoComplete="off"
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
        <p className="muted invite-note">Запомни логин и PIN: по ним ты будешь входить. Сменить их можно в Профиле → Настройки.</p>
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
