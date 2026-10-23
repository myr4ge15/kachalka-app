import { useEffect, useRef, useState } from 'react'
import CardsSkeleton from '../ui/CardsSkeleton.jsx'
import { showToast } from '../ui/Toast.jsx'
import FeedbackPhotos from '../social/FeedbackPhotos.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import {
  contextLine, fmtFeedbackDate, groupAttachments, laterLabel, hasReply, isOpenStatus, openCount, FEEDBACK_MAX, FEEDBACK_STATUSES, STATUS_LABEL,
} from '../../lib/feedback.js'
import {
  adminListFeedback, adminUpdateFeedback, feedbackMedia, feedbackShotUrl, FeedbackError,
} from '../../lib/feedbackApi.js'

const defaultApi = { list: adminListFeedback, update: adminUpdateFeedback, shot: feedbackShotUrl, media: feedbackMedia }
const errText = (e) => (e instanceof FeedbackError ? e.message : String(e?.message ?? e))

// Админка → «Обращения» (v6.11.0): бэклог обратной связи участников. Новые и «в
// работе» сверху (порядок задает сервер). Статус + ответ сохраняются одной
// кнопкой; сервер сам решает, уведомить ли автора пушем (новый ответ или
// закрытие обращения). Пропсы: online, [api] — для тестов.
// cache (v8.0.1) — кэш визита Админки (lib/adminCache.js): готовый список рисуется сразу.
export default function AdminFeedback({ online, api = defaultApi, cache = null }) {
  const [rows, setRows] = useState(() => cache?.peek('feedback') ?? null)
  const [loadErr, setLoadErr] = useState('')
  const [filter, setFilter] = useState('open') // 'open' | 'all'
  const [editId, setEditId] = useState(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function reload({ force = true } = {}) {
    setLoadErr('')
    try {
      const data = cache ? await cache.load('feedback', () => api.list(false), { force }) : await api.list(false)
      if (alive.current) setRows(data)
    } catch (e) {
      if (!alive.current) return
      setLoadErr(errText(e))
      setRows([])
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (online) reload({ force: false }); else setRows((r) => r ?? []) }, [online])

  const shown = (rows ?? []).filter((r) => filter === 'all' || isOpenStatus(r.status))
  const open = openCount(rows)

  return (
    <section className="sec fb-admin">
      <div className="seg fb-filter" role="tablist">
        <button role="tab" aria-selected={filter === 'open'} className={'seg-item' + (filter === 'open' ? ' on' : '')}
          onClick={() => setFilter('open')}>
          Открытые{rows ? ` · ${open}` : ''}
        </button>
        <button role="tab" aria-selected={filter === 'all'} className={'seg-item' + (filter === 'all' ? ' on' : '')}
          onClick={() => setFilter('all')}>
          Все{rows ? ` · ${rows.length}` : ''}
        </button>
      </div>

      {loadErr && (
        <div>
          <p className="admin-offline" role="alert">{loadErr}</p>
          <button className="btn ghost" onClick={reload} disabled={!online}>Повторить</button>
        </div>
      )}
      {rows === null && <CardsSkeleton cards={2} />}
      {rows && shown.length === 0 && !loadErr && (
        <p className="muted">{filter === 'open' ? 'Открытых обращений нет 🎉' : 'Обращений пока нет.'}</p>
      )}
      {shown.length > 0 && (
        <ul className="admin-list">
          {shown.map((r) => (
            <FeedbackCard
              key={r.id}
              row={r}
              online={online}
              api={api}
              editing={editId === r.id}
              onEdit={() => setEditId((cur) => (cur === r.id ? null : r.id))}
              onSaved={() => { setEditId(null); reload() }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function FeedbackCard({ row, online, api, editing, onEdit, onSaved }) {
  const [shotUrl, setShotUrl] = useState(null)
  const [shotBusy, setShotBusy] = useState(false)
  const version = row.context?.version
  const ctx = contextLine({ ...row.context, version: null })
  const groups = groupAttachments(row.screenshot_count, row.screenshot_times, row.additions, row.created_at)

  async function showShot() {
    if (shotBusy) return
    setShotBusy(true)
    try {
      setShotUrl(await api.shot(row.screenshot_path))
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Скриншот не открылся', sub: errText(e) })
    } finally {
      setShotBusy(false)
    }
  }

  return (
    <li className="admin-user fb-item">
      <div className="fb-item-head">
        <span className="admin-ex-name"><span>{row.author_name}</span></span>
        <span className={`fb-status s-${row.status}`}>{STATUS_LABEL[row.status] ?? row.status}</span>
      </div>
      <span className="admin-ex-meta">{fmtFeedbackDate(row.created_at)}</span>
      <p className="fb-body">{row.body}</p>
      {/* Вложения по месту (fb_37f0c1a8): исходные — у текста обращения, приложенные позже — под дополнением. */}
      {row.screenshot_count > 0 && <FeedbackPhotos id={row.id} kind="screenshots" indices={groups.base}
        load={api.media} lazy disabled={!online} label={`Скриншот от ${row.author_name}`} />}
      {row.additions?.map((a) => (
        <div key={a.n}>
          <p className="fb-addition">
            <span aria-hidden="true">➕ </span>{a.body}
            <span className="admin-ex-meta"> · {fmtFeedbackDate(a.created_at)}</span>
          </p>
          {groups.byAddition[a.n] && <FeedbackPhotos id={row.id} kind="screenshots" indices={groups.byAddition[a.n]}
            load={api.media} lazy disabled={!online} label="Вложение к дополнению" />}
        </div>
      ))}
      {groups.later.length > 0 && <FeedbackPhotos id={row.id} kind="screenshots" indices={groups.later}
        load={api.media} lazy disabled={!online} label={laterLabel(row.screenshot_times, groups.later)} />}
      {(version || ctx) && (
        <p className="admin-ex-meta fb-ctx">
          {version && <span className="version-number">v{version}</span>}
          {version && ctx ? ' · ' : ''}{ctx}
        </p>
      )}
      {row.reopened_at && row.reopen_note && (
        <p className="fb-reopen">
          <span aria-hidden="true">🔁 </span>Открыто снова{row.reopen_count > 1 ? ` (${row.reopen_count}-й раз)` : ''}: {row.reopen_note}
        </p>
      )}
      {/* v6.12.0: отправленный в Telegram скриншот живет там (file_id), в Storage — только недошедший. */}
      {!row.screenshot_count && !row.screenshot_path && row.has_screenshot_tg && (
        <FeedbackPhotos id={row.id} kind="shot" count={1} load={api.media} lazy disabled={!online}
          label={`Скриншот от ${row.author_name}`} />
      )}
      {!row.screenshot_count && row.screenshot_path && (shotUrl ? (
        <a className="fb-shot" href={shotUrl} target="_blank" rel="noreferrer">
          <img src={shotUrl} alt={`Скриншот от ${row.author_name}`} />
        </a>
      ) : (
        <button className="btn ghost fb-attach" onClick={showShot} disabled={!online || shotBusy}>
          {shotBusy ? 'Открываю…' : '📎 Показать скриншот'}
        </button>
      ))}
      {hasReply(row) && !editing && (
        <div className="fb-reply">
          <div className="fb-reply-head">
            <span>Ответ · {fmtFeedbackDate(row.replied_at)}{row.reply_seen_at ? ' · прочитан' : ''}</span>
          </div>
          {row.reply && <p className="fb-body">{row.reply}</p>}
          {row.reply_photos > 0 && (
            <FeedbackPhotos id={row.id} kind="reply" count={row.reply_photos} load={api.media} lazy
              disabled={!online} label="Фото ответа" />
          )}
        </div>
      )}
      {editing
        ? <FeedbackEditor row={row} online={online} api={api} onCancel={onEdit} onSaved={onSaved} />
        : (
          <button className="btn ghost fb-edit-btn" onClick={onEdit} disabled={!online}>
            {row.reply ? 'Изменить ответ или статус' : 'Ответить / сменить статус'}
          </button>
        )}
    </li>
  )
}

function FeedbackEditor({ row, online, api, onCancel, onSaved }) {
  // Редактор появляется только по нажатию — сразу в видимую область (v8.0.1).
  const editorRef = useRevealFocus('fb-editor')
  const [status, setStatus] = useState(row.status === 'new' ? 'in_progress' : row.status)
  const [reply, setReply] = useState(row.reply ?? '')
  const [busy, setBusy] = useState(false)
  const tooLong = reply.trim().length > FEEDBACK_MAX

  async function save() {
    if (busy || tooLong) return
    setBusy(true)
    try {
      const res = await api.update(row.id, status, reply)
      showToast({
        emoji: '✅',
        title: 'Сохранено',
        sub: res.notified
          ? (res.pushed ? 'Автору отправлено уведомление.' : 'Ответ виден автору в приложении (пуши у него выключены).')
          : 'Без уведомления автору.',
      })
      onSaved()
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не сохранилось', sub: errText(e) })
      setBusy(false)
    }
  }

  return (
    <div ref={editorRef} className="admin-merge fb-editor">
      <span className="field-lab">Статус</span>
      <div className="fb-status-pick" role="radiogroup" aria-label="Статус обращения">
        {FEEDBACK_STATUSES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={status === s}
            className={'seg-item' + (status === s ? ' on' : '')} onClick={() => setStatus(s)} disabled={busy}>
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field-lab">Ответ автору (необязательно)</span>
        <textarea className="admin-input fb-text" rows={3} value={reply} disabled={busy}
          placeholder="Например: исправлено в версии 6.11.1, обнови приложение"
          onChange={(e) => setReply(e.target.value)} />
      </label>
      <p className="admin-hint">Автору придет уведомление, если ответ новый или обращение закрыто.</p>
      <div className="invite-fresh-actions">
        <button className="btn primary" onClick={save} disabled={busy || !online || tooLong}>
          {busy ? 'Сохраняю…' : 'Сохранить'}
        </button>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Отмена</button>
      </div>
    </div>
  )
}
