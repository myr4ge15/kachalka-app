import { useState } from 'react'
import FeedbackPhotos from './FeedbackPhotos.jsx'
import FeedbackNoteForm from './FeedbackNoteForm.jsx'
import FeedbackAddScreenshots from './FeedbackAddScreenshots.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import {
  appendProblem, canAppend, canReopen, fmtFeedbackDate, hasReply, isStaleReply, reopenProblem,
  APPEND_MAX, REOPEN_MAX, STATUS_LABEL,
} from '../../lib/feedback.js'

// Одно обращение в «Моих обращениях» (16.10: список был громоздким — каждое обращение во всю
// высоту со всеми фото и кнопками). Свернутое — строка: дата, статус, начало текста, начало
// ответа, значки 📎/➕. Тап раскрывает целиком. Раскрыто сразу — пришли пушем или есть новый ответ.
// Пропсы: row, userId, api, online, fresh (ответ новый), focus (пришли пушем), onReload().
export default function MyFeedbackItem({ row: r, userId, api, online, fresh = false, focus = false, onReload }) {
  const [open, setOpen] = useState(fresh || focus)
  // Reveal — только на раскрытие пальцем, не на начальное (см. useRevealFocus).
  const [rev, setRev] = useState(0)
  const revealRef = useRevealFocus(rev || null, { block: 'nearest' })
  const shots = Number(r.screenshot_count) || (r.has_screenshot ? 1 : 0)
  const adds = r.additions?.length ?? 0

  function toggle() {
    setOpen((o) => !o)
    if (!open) setRev((n) => n + 1)
  }

  return (
    <li ref={revealRef} id={`fb-${r.id}`} className={'admin-user fb-item' + (focus ? ' focus' : '') + (open ? ' open' : '')}>
      <button type="button" className="fb-item-toggle" onClick={toggle} aria-expanded={open}>
        <span className="fb-item-head">
          <span className="admin-ex-meta">{fmtFeedbackDate(r.created_at)}</span>
          <span className="fb-item-tags">
            {fresh && <span className="act-badge">новый</span>}
            <span className={`fb-status s-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
          </span>
        </span>
        {!open && (
          <>
            <span className="fb-item-sum">{r.body}</span>
            {hasReply(r) && (
              <span className="fb-item-reply">
                <span aria-hidden="true">💬 </span><span>{r.reply || 'Ответ с фото'}</span>
              </span>
            )}
            {(shots > 0 || adds > 0) && (
              <span className="fb-item-marks admin-ex-meta">
                {shots > 0 && <span>📎 {shots}</span>}
                {adds > 0 && <span>➕ {adds}</span>}
              </span>
            )}
          </>
        )}
      </button>
      {open && (
        <>
          <p className="fb-body">{r.body}</p>
          {r.additions?.map((a) => (
            <p key={a.n} className="fb-addition">
              <span aria-hidden="true">➕ </span>{a.body}
              <span className="admin-ex-meta"> · {fmtFeedbackDate(a.created_at)}</span>
            </p>
          ))}
          {r.screenshot_count > 0 ? <FeedbackPhotos id={r.id} kind="screenshots" count={r.screenshot_count}
            load={api.media} lazy disabled={!online} label="Скриншот к обращению" />
            : r.has_screenshot && <span className="admin-ex-meta">📎 со скриншотом</span>}
          <FeedbackAddScreenshots row={r} userId={userId} api={api} online={online} onDone={onReload} />
          {r.reopened_at && r.reopen_note && (
            <p className="fb-reopen"><span aria-hidden="true">🔁 </span>Открыто снова: {r.reopen_note}</p>
          )}
          {hasReply(r) && (
            <div className={'fb-reply' + (fresh ? ' new' : '') + (isStaleReply(r) ? ' stale' : '')}>
              <div className="fb-reply-head">
                <span>{isStaleReply(r) ? 'Прошлый ответ' : 'Ответ разработчика'} · {fmtFeedbackDate(r.replied_at)}</span>
              </div>
              {r.reply && <p className="fb-body">{r.reply}</p>}
              {r.reply_photos > 0 && (
                <FeedbackPhotos id={r.id} kind="reply" count={r.reply_photos} load={api.media}
                  label="Скриншот от разработчика" />
              )}
            </div>
          )}
          {canAppend(r) && (
            <FeedbackNoteForm
              openLabel="Дополнить"
              label="Что добавить?"
              placeholder="Например: и еще — то же самое на экране Ленты"
              sendLabel="Дописать"
              max={APPEND_MAX}
              problem={appendProblem}
              send={(note) => api.append(r.id, note)}
              done={{ emoji: '➕', title: 'Дополнение отправлено', sub: 'Разработчик увидит его в том же обращении.' }}
              online={online}
              onDone={onReload}
            />
          )}
          {canReopen(r) && (
            <FeedbackNoteForm
              openLabel="Не помогло — открыть снова"
              label="Что не так?"
              placeholder="Например: после обновления подход все равно пропадает"
              sendLabel="Открыть снова"
              max={REOPEN_MAX}
              problem={reopenProblem}
              send={(note) => api.reopen(r.id, note)}
              done={{ emoji: '🔁', title: 'Обращение открыто снова', sub: 'Разработчик увидит твой комментарий.' }}
              online={online}
              onDone={onReload}
            />
          )}
        </>
      )}
    </li>
  )
}
