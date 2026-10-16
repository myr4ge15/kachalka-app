import { useState } from 'react'
import { showToast } from '../ui/Toast.jsx'
import FeedbackScreenshotPicker from './FeedbackScreenshotPicker.jsx'
import { cleanBody } from '../../lib/feedback.js'
import { FeedbackError } from '../../lib/feedbackApi.js'

// Короткий комментарий к своему обращению — кнопка раскрывается в поле с «Отправить»
// и «Отмена». Одна форма на два случая экрана «Обратная связь»:
//   «Не помогло — открыть снова» (v6.12.0) — к решенному/отклоненному;
//   «Дополнить» (v8.6.0) — к открытому, статус не меняется.
// Пропсы: openLabel, label, placeholder, sendLabel, max, problem(text) → код|null,
// send(text) → Promise, done: { emoji, title, sub } для тоста, online, onDone().
// attach (16.10, fb_a4e36c94: в «Дополнить» не приложить скриншот) — { max, send(files),
// textOptional, testId }: вложения прямо в форме; textOptional — можно без текста, одни файлы.
export default function FeedbackNoteForm({
  openLabel, label, placeholder, sendLabel, max, problem: problemOf, send, done, online, onDone, attach = null,
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const len = cleanBody(note).length
  const filesOnly = !!attach?.textOptional && files.length > 0 && len === 0
  const problem = filesOnly ? null : problemOf(note)

  function close() { setOpen(false); setNote(''); setFiles([]) }

  async function submit() {
    if (busy || problem || !online) return
    setBusy(true)
    let textSent = false
    try {
      if (!filesOnly) { await send(note); textSent = true; setNote('') }
      if (files.length) await attach.send(files)
      showToast(done)
      close()
      onDone?.()
    } catch (e) {
      // Текст уже ушел, файлы — нет: выбор файлов остается, повторно уйдут только они.
      showToast({ emoji: '⚠️', title: textSent ? 'Текст отправлен, файлы — нет' : 'Не отправилось',
        sub: e instanceof FeedbackError ? e.message : e?.message || 'Попробуй еще раз.' })
      if (textSent) onDone?.()
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
      {attach && attach.max > 0 && (
        <FeedbackScreenshotPicker files={files} onChange={setFiles} disabled={busy || !online} max={attach.max}
          testId={attach.testId} />
      )}
      <div className="invite-fresh-actions">
        <button className="btn primary" onClick={submit} disabled={busy || !!problem || !online}>
          {busy ? 'Отправляю…' : sendLabel}
        </button>
        <button className="btn ghost" onClick={close} disabled={busy}>Отмена</button>
      </div>
    </div>
  )
}
