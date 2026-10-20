import { useState } from 'react'
import { showToast } from '../ui/Toast.jsx'
import BusyText from '../ui/BusyText.jsx'
import UploadProgress from './UploadProgress.jsx'
import FeedbackScreenshotPicker from './FeedbackScreenshotPicker.jsx'
import { cleanBody } from '../../lib/feedback.js'
import { FeedbackError } from '../../lib/feedbackApi.js'
import { useAttachments } from '../../hooks/useAttachments.js'

// Короткий комментарий к своему обращению — кнопка раскрывается в поле с «Отправить»
// и «Отмена». Одна форма на два случая экрана «Обратная связь»:
//   «Не помогло — открыть снова» (v6.12.0) — к решенному/отклоненному;
//   «Дополнить» (v8.6.0) — к открытому, статус не меняется.
// Пропсы: openLabel, label, placeholder, sendLabel, max, problem(text) → код|null,
// send(text) → Promise, done: { emoji, title, sub } для тоста, online, onDone().
// attach (16.10, fb_a4e36c94: в «Дополнить» не приложить скриншот) — { max, send(paths),
// textOptional, testId, userId, api: {upload, discard} }: вложения прямо в форме, грузятся сразу
// после выбора (20.10, useAttachments); textOptional — можно без текста, одни файлы.
export default function FeedbackNoteForm({
  openLabel, label, placeholder, sendLabel, max, problem: problemOf, send, done, online, onDone, attach = null,
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const att = useAttachments(attach?.userId, attach?.api)
  const [busy, setBusy] = useState(false)
  const len = cleanBody(note).length
  const filesOnly = !!attach?.textOptional && att.items.length > 0 && len === 0
  const problem = filesOnly ? null : problemOf(note)

  // Отмена — загруженное удаляется; после отправки (commit) файлы уже принадлежат обращению.
  function close({ sent = false } = {}) { setOpen(false); setNote(''); if (sent) att.commit(); else att.clear() }

  async function submit() {
    if (busy || problem || !online) return
    setBusy(true)
    let textSent = false
    try {
      // Сначала догрузка вложений: не загрузилось — не шлем и текст, чтобы не было «половины».
      const paths = att.items.length ? await att.readyPaths() : null
      if (!filesOnly) { await send(note); textSent = true; setNote('') }
      if (paths) await attach.send(paths)
      showToast(done)
      close({ sent: true })
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
        <FeedbackScreenshotPicker items={att.items} onAdd={att.add} onRemove={att.remove} onRetry={att.retry}
          disabled={busy || !online} max={attach.max} testId={attach.testId} />
      )}
      {busy && att.progress && <UploadProgress progress={att.progress} />}
      <div className="invite-fresh-actions">
        <button className="btn primary" onClick={submit} disabled={busy || !!problem || !online}>
          {busy ? <BusyText>{att.uploading ? 'Догружаю' : 'Отправляю'}</BusyText> : sendLabel}
        </button>
        <button className="btn ghost" onClick={() => close()} disabled={busy}>Отмена</button>
      </div>
    </div>
  )
}
