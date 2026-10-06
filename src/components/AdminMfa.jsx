import { useState } from 'react'
import { verifyCode, startEnroll, disableMfa, cleanCode, groupSecret, MfaError } from '../lib/adminMfa.js'

// 2FA Админки (v6.14.0). Две части:
//   AdminMfaGate  — код из приложения перед Админкой (сессия → aal2);
//   AdminMfaPanel — секция «Защита (2FA)»: включить (QR + первый код) / отключить.
// Решает сервер (is_admin() + Edge admin-*), это лишь интерфейс к supabase.auth.mfa.

const errText = (e) => (e instanceof MfaError ? e.message : String(e?.message ?? e))

function CodeField({ value, onChange, disabled, autoFocus }) {
  return (
    <label className="field">
      <span className="field-lab">Код из приложения</span>
      <input className="pin-input mfa-code" type="text" inputMode="numeric" autoComplete="one-time-code"
        placeholder="000000" maxLength={7} autoFocus={autoFocus} disabled={disabled}
        value={value} onChange={(e) => onChange(cleanCode(e.target.value))} />
    </label>
  )
}

export function AdminMfaGate({ factorId, online, onPassed }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e?.preventDefault()
    if (busy || code.length !== 6) return
    setBusy(true); setErr('')
    try {
      await verifyCode(factorId, code)
      onPassed()
    } catch (x) {
      setErr(errText(x)); setCode(''); setBusy(false)
    }
  }

  return (
    <form className="admin-merge mfa-gate" onSubmit={submit}>
      <p className="admin-merge-title">🔐 Подтверди, что это ты</p>
      <p className="admin-hint">Админка защищена 2FA. Введи 6 цифр из приложения-аутентификатора — до конца этой сессии код больше не спросим.</p>
      <CodeField value={code} onChange={(v) => { setCode(v); setErr('') }} disabled={busy || !online} autoFocus />
      {err && <p className="pin-err" role="alert">{err}</p>}
      {!online && <p className="admin-hint">Нет сети — код проверяется только онлайн.</p>}
      <button className="btn primary" type="submit" disabled={busy || !online || code.length !== 6}>
        {busy ? 'Проверяю…' : 'Войти в Админку'}
      </button>
    </form>
  )
}

export function AdminMfaPanel({ state, online, onChange }) {
  const [enroll, setEnroll] = useState(null) // { factorId, qr, secret }
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)

  async function run(fn) {
    setBusy(true); setErr('')
    try { await fn() } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }

  const begin = () => run(async () => { setEnroll(await startEnroll(state)); setCode('') })
  const confirm = () => run(async () => {
    await verifyCode(enroll.factorId, code)
    setEnroll(null); setCode('')
    await onChange()
  })
  const turnOff = () => {
    if (!confirmOff) { setConfirmOff(true); return }
    run(async () => { await disableMfa(state.factorId); setConfirmOff(false); await onChange() })
  }

  if (state?.enabled) {
    return (
      <div className="admin-merge">
        <p className="admin-merge-title">✅ 2FA включена</p>
        <p className="admin-hint">Перед Админкой в каждой новой сессии (после входа по PIN) спросим код из приложения. Без кода сервер админ-операции не выполнит, даже если кто-то узнает твой PIN.</p>
        <p className="admin-hint">Потерял телефон с приложением — снять защиту можно только из SQL Editor (запрос — в supabase/admin-mfa.sql).</p>
        {err && <p className="pin-err" role="alert">{err}</p>}
        <button className="btn ghost" onClick={turnOff} disabled={busy || !online}>
          {confirmOff ? 'Точно отключить?' : 'Отключить 2FA'}
        </button>
      </div>
    )
  }

  if (enroll) {
    return (
      <div className="admin-merge">
        <p className="admin-merge-title">Шаг 1 — добавь в приложение</p>
        <p className="admin-hint">Google Authenticator, Aegis, 2FAS, «Пароли» на iPhone — любое с кодами TOTP. Отсканируй QR или введи ключ вручную.</p>
        {enroll.qr && <img className="mfa-qr" src={enroll.qr} alt="QR-код для приложения-аутентификатора" width="180" height="180" />}
        <p className="mfa-secret" aria-label="Ключ для ручного ввода">{groupSecret(enroll.secret)}</p>
        <p className="admin-merge-title">Шаг 2 — введи код</p>
        <CodeField value={code} onChange={(v) => { setCode(v); setErr('') }} disabled={busy || !online} />
        <p className="admin-hint">После подтверждения остальные твои сессии (другие телефоны) завершатся — там войдешь заново по PIN.</p>
        {err && <p className="pin-err" role="alert">{err}</p>}
        <div className="admin-ex-actions">
          <button className="btn ghost" onClick={() => { setEnroll(null); setErr('') }} disabled={busy}>Отмена</button>
          <button className="btn primary" onClick={confirm} disabled={busy || !online || code.length !== 6}>
            {busy ? 'Проверяю…' : 'Включить'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-merge">
      <p className="admin-merge-title">2FA выключена</p>
      <p className="admin-hint">Вход в приложение — 4 цифры PIN. Для админки этого мало: с 2FA сервер выполнит админ-операции только после кода из приложения-аутентификатора на твоем телефоне.</p>
      {err && <p className="pin-err" role="alert">{err}</p>}
      <button className="btn primary" onClick={begin} disabled={busy || !online}>
        {busy ? 'Готовлю…' : 'Включить 2FA'}
      </button>
    </div>
  )
}
