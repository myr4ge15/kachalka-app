import { useState } from 'react'
import { submitJoin, validateJoin, joinErrorText, NAME_MAX, ABOUT_MAX, JoinError } from '../lib/joinRequest.js'

// Форма «Хочу в круг» (v6.12.0): имя + пара слов → владельцу в Telegram.
// Пропсы: onSubmitted(pending) — заявка принята сервером; onBack() — назад.
// Скрытое поле website — ловушка для ботов: человек его не видит.
export default function JoinRequestForm({ onSubmitted, onBack }) {
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [website, setWebsite] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const problem = validateJoin({ name, about })
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      const pending = await submitJoin({ name, about, website })
      onSubmitted?.(pending)
    } catch (err) {
      setError(joinErrorText(err instanceof JoinError ? err.code : 'server'))
      setBusy(false)
    }
  }

  return (
    <form className="invite-form" onSubmit={submit} noValidate>
      <p className="invite-lead">
        Пока это приложение для закрытого круга лиц. Введи данные о себе — после одобрения владелец пришлет приглашение сюда же.
      </p>
      <label className="field">
        <span className="field-lab">Как тебя зовут</span>
        <input className="admin-input" type="text" maxLength={NAME_MAX} autoComplete="name"
          value={name} disabled={busy} onChange={(e) => { setName(e.target.value); setError('') }} />
      </label>
      <label className="field">
        <span className="field-lab">Пара слов о себе</span>
        <textarea className="admin-input fb-text join-about" rows={3} maxLength={ABOUT_MAX + 50}
          placeholder="Например: друг Димы, хожу в зал по вторникам" value={about} disabled={busy}
          onChange={(e) => { setAbout(e.target.value); setError('') }} />
      </label>
      <div className="hp" aria-hidden="true">
        <label>Сайт<input type="text" tabIndex={-1} autoComplete="off" value={website}
          onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Отправляю…' : 'Отправить заявку'}
      </button>
      <button className="btn ghost" type="button" onClick={onBack} disabled={busy}>Назад</button>
    </form>
  )
}
