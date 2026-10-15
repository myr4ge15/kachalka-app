import { useState } from 'react'
import { showToast } from '../ui/Toast.jsx'
import { cleanBody } from '../../lib/feedback.js'
import { FeedbackError } from '../../lib/feedbackApi.js'

// Короткий комментарий к своему обращению — кнопка раскрывается в поле с «Отправить»
// и «Отмена». Одна форма на два случая экрана «Обратная связь»:
//   «Не помогло — открыть снова» (v6.12.0) — к решенному/отклоненному;
//   «Дополнить» (v8.6.0) — к открытому, статус не меняется.
// Пропсы: openLabel, label, placeholder, sendLabel, max, problem(text) → код|null,
// send(text) → Promise, done: { emoji, title, sub } для тоста, online, onDone().
export default function FeedbackNoteForm({
  openLabel, label, placeholder, sendLabel, max, problem: problemOf, send, done, online, onDone,
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const problem = problemOf(note)
  const len = cleanBody(note).length

  async function submit() {
    if (busy || problem || !online) return
    setBusy(true)
    try {
      await send(note)
      showToast(done)
      setOpen(false)
      setNote('')
      onDone?.()
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не отправилось', sub: e instanceof FeedbackError ? e.message : 'Попробуй еще раз.' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn ghost fb-reopen-btn" onClick={() => setOpen(true)} disabled={!online}>
        {openLabel}
      </button>
    )
  }
  return (
    <div className="fb-reopen-form">
      <label className="field">
        <span className="field-lab">{label}</span>
        <textarea className="admin-input fb-text" rows={3} maxLength={max + 100} value={note} disabled={busy}
          placeholder={placeholder} autoFocus onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className={'fb-count' + (len > max ? ' over' : '')} aria-live="polite">{len} / {max}</div>
      <div className="invite-fresh-actions">
        <button className="btn primary" onClick={submit} disabled={busy || !!problem || !online}>
          {busy ? 'Отправляю…' : sendLabel}
        </button>
        <button className="btn ghost" onClick={() => { setOpen(false); setNote('') }} disabled={busy}>Отмена</button>
      </div>
    </div>
  )
}
