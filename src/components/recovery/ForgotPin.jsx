import { useEffect, useRef, useState } from 'react'
import { requestPinReset, resetPinByCode, createRecoveryCode, LoginError } from '../../lib/auth.js'
import { normalizeLogin } from '../../lib/login.js'
import { recoveryCodeLooksValid, resetErrorText } from '../../lib/recovery.js'
import NewPinFields, { newPinProblem } from './NewPinFields.jsx'
import RecoveryCodeView from './RecoveryCodeView.jsx'

function errText(e) {
  if (e instanceof LoginError && e.code === 'locked' && e.retryAfter) {
    return `Слишком много попыток. Попробуй через ${Math.ceil(e.retryAfter / 60)} мин.`
  }
  return resetErrorText(e instanceof LoginError ? e.code : 'server')
}

// «Забыл PIN» на экране входа (П1 «Мой круг», 07.10.2026). Два пути:
//   • Telegram — бот присылает одноразовую ссылку (если Telegram привязан в Профиле).
//     Ответ один и тот же при любом логине: по экрану не выяснить, есть ли учетка;
//   • код восстановления — логин + код + новый PIN → сразу вход; старый код гаснет,
//     поэтому тут же выдаем новый (показываем один раз, потом — в приложение).
// Только онлайн. Пропсы: initialLogin, onBack(), onLogin(user).
export default function ForgotPin({ initialLogin = '', onBack, onLogin }) {
  const [way, setWay] = useState('tg') // 'tg' | 'sent' | 'code' | 'new-code'
  const [login, setLogin] = useState(initialLogin)
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState(null) // { user, code }
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  function edit(setter) { return (v) => { setter(v); setError('') } }

  async function sendLink(e) {
    e.preventDefault()
    if (busy) return
    if (!normalizeLogin(login)) { setError('Напиши логин.'); return }
    if (!navigator.onLine) { setError(resetErrorText('network')); return }
    setBusy(true); setError('')
    try {
      await requestPinReset(normalizeLogin(login))
      if (alive.current) setWay('sent')
    } catch (err) {
      if (alive.current) setError(errText(err))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  async function byCode(e) {
    e.preventDefault()
    if (busy) return
    if (!normalizeLogin(login)) { setError('Напиши логин.'); return }
    if (!recoveryCodeLooksValid(code)) { setError('Код — 16 знаков, как его выдали: XXXX-XXXX-XXXX-XXXX.'); return }
    const p = newPinProblem(pin, pin2)
    if (p) { setError(p); return }
    if (!navigator.onLine) { setError(resetErrorText('network')); return }
    setBusy(true); setError('')
    let user
    try {
      user = await resetPinByCode(normalizeLogin(login), code, pin)
    } catch (err) {
      if (alive.current) { setError(errText(err)); setBusy(false) }
      return
    }
    // Старый код погашен — выдаем новый. Не вышло — не страшно: выпустит в Профиле.
    let next = null
    try { next = await createRecoveryCode(user.id) } catch { /* позже в Профиле */ }
    if (!alive.current) return
    if (next) { setFresh({ user, code: next }); setWay('new-code'); setBusy(false) } else onLogin(user)
  }

  if (way === 'new-code' && fresh) {
    return (
      <>
        <p className="invite-lead">PIN сменен ✅ Старый код больше не действует — вот новый.</p>
        <RecoveryCodeView code={fresh.code} doneLabel="Сохранил, войти" onDone={() => onLogin(fresh.user)} />
      </>
    )
  }

  if (way === 'sent') {
    return (
      <>
        <p className="invite-lead" role="status">
          Если у учетки привязан Telegram, бот уже прислал ссылку для нового PIN. Она действует 10 минут.
        </p>
        <p className="muted invite-note">Ничего не пришло — Telegram не привязан. Тогда — по коду восстановления или через админа.</p>
        <div className="invite-actions">
          <button type="button" className="btn ghost" onClick={onBack}>К входу</button>
          <button type="button" className="btn primary" onClick={() => { setError(''); setWay('code') }}>Ввести код</button>
        </div>
      </>
    )
  }

  const loginField = (
    <div className="field">
      <label className="field-lab" htmlFor="forgot-login">Логин</label>
      <input id="forgot-login" className="admin-input" type="text" maxLength={20} autoComplete="username"
        autoCapitalize="none" autoCorrect="off" spellCheck={false}
        value={login} disabled={busy} onChange={(e) => edit(setLogin)(e.target.value)} />
    </div>
  )

  if (way === 'code') {
    return (
      <form className="invite-form" onSubmit={byCode} noValidate>
        <p className="invite-lead">Восстановление по коду</p>
        {loginField}
        <div className="field">
          <label className="field-lab" htmlFor="forgot-code">Код восстановления</label>
          <input id="forgot-code" className="admin-input recovery-code-input" type="text" maxLength={24}
            autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={code} disabled={busy} onChange={(e) => edit(setCode)(e.target.value)} />
        </div>
        <NewPinFields pin={pin} pin2={pin2} onPin={edit(setPin)} onPin2={edit(setPin2)} disabled={busy} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Проверяю…' : 'Сменить PIN и войти'}</button>
        <div className="login-alt">
          <button type="button" className="link-btn" disabled={busy} onClick={() => { setError(''); setWay('tg') }}>Через Telegram</button>
          <button type="button" className="link-btn" disabled={busy} onClick={onBack}>К входу</button>
        </div>
      </form>
    )
  }

  return (
    <form className="invite-form" onSubmit={sendLink} noValidate>
      <p className="invite-lead">Бот в Telegram пришлет ссылку — по ней задашь новый PIN.</p>
      {loginField}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Отправляю…' : 'Прислать ссылку в Telegram'}</button>
      <div className="login-alt">
        <button type="button" className="link-btn" disabled={busy} onClick={() => { setError(''); setWay('code') }}>Нет Telegram? Восстановить кодом</button>
        <button type="button" className="link-btn" disabled={busy} onClick={onBack}>К входу</button>
      </div>
      <p className="muted invite-note">Нет ни Telegram, ни кода — попроси админа сбросить PIN.</p>
    </form>
  )
}
