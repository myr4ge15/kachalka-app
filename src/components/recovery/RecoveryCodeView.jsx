import { useState } from 'react'

// Код восстановления (П1, 07.10.2026) — показывается ОДИН раз: на сервере хранится
// только хэш, второй раз его не узнать (можно лишь выпустить новый, старый сгорит).
export default function RecoveryCodeView({ code, onDone, doneLabel = 'Я сохранил код' }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch { /* нет доступа к буферу — пусть перепишет руками */ }
  }
  return (
    <div className="recovery-code" role="group" aria-label="Код восстановления">
      <p className="invite-lead">🔐 Код восстановления</p>
      <p className="recovery-code-value" data-testid="recovery-code">{code}</p>
      <p className="muted invite-note">
        Забудешь PIN — войдешь по логину и этому коду, без админа. Сохрани его в заметках или
        менеджере паролей: больше он не покажется. Код одноразовый.
      </p>
      <div className="invite-actions">
        <button type="button" className="btn ghost" onClick={copy}>{copied ? 'Скопировано ✓' : 'Скопировать'}</button>
        <button type="button" className="btn primary" onClick={onDone}>{doneLabel}</button>
      </div>
    </div>
  )
}
