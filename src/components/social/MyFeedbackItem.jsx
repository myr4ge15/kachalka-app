import { useState } from 'react'
import FeedbackPhotos from './FeedbackPhotos.jsx'
import FeedbackNoteForm from './FeedbackNoteForm.jsx'
import Chevron from '../ui/Chevron.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import {
  appendProblem, canAppend, canReopen, fmtFeedbackDate, groupAttachments, laterLabel, hasReply, isStaleReply, reopenProblem,
  APPEND_MAX, FEEDBACK_SHOTS_MAX, REOPEN_MAX, STATUS_LABEL,
} from '../../lib/feedback.js'
import Icon from '../ui/Icon.jsx'

// Одно обращение в «Моих обращениях» (16.10: список был громоздким — каждое обращение во всю
// высоту со всеми фото и кнопками). Свернутое — строка: дата, статус, начало текста, начало
// ответа, значки 📎/➕. Тап раскрывает целиком. Раскрыто сразу — только если пришли пушем/из уведомления
// (9.3.3: раньше и с новым ответом — после пачки ответов раскрытым оказывался весь список; новый
// ответ теперь — метка «новый» на свернутой строке).
// 16.10 (fb_bd776cf0): стрелка в шапке — свернуть раскрытое было нечем, кроме неочевидного тапа по
// дате; отдельную «Свернуть» внизу убрали (9.3.3) — стрелки и тапа по шапке хватает. Вложения — внутри «Дополнить» / «Открыть снова» (fb_a4e36c94).
// Метка «новый» гаснет, как только обращение раскрыли (9.3.3); подсветка ответа внутри остается.
// Пропсы: row, userId, api, online, fresh (ответ новый), focus (пришли пушем), onSeen(id), onReload().
export default function MyFeedbackItem({ row: r, userId, api, online, fresh = false, focus = false, onSeen, onReload }) {
  const [open, setOpen] = useState(focus)
  const [seen, setSeen] = useState(focus)
  // Пришли к этому обращению уже при открытом экране (новое уведомление) — раскрыть.
  const [focusSeen, setFocusSeen] = useState(focus)
  if (focus !== focusSeen) {
    setFocusSeen(focus)
    if (focus) { setOpen(true); setSeen(true) }
  }
  // Reveal — только на раскрытие пальцем, не на начальное (см. useRevealFocus).
  const [rev, setRev] = useState(0)
  const revealRef = useRevealFocus(rev || null, { block: 'center' })
  const shots = Number(r.screenshot_count) || (r.has_screenshot ? 1 : 0)
  const adds = r.additions?.length ?? 0
  const groups = groupAttachments(r.screenshot_count, r.screenshot_times, r.additions, r.created_at)

  // Сколько еще можно приложить (всего до FEEDBACK_SHOTS_MAX) и как.
  const room = FEEDBACK_SHOTS_MAX - shots
  const attachTo = (textOptional) => (room > 0
    ? { max: room, textOptional, testId: 'fb-file-' + r.id, userId, api, send: (paths) => api.attach(userId, r.id, paths) }
    : null)

  function toggle() {
    setOpen((o) => !o)
    if (!open) {
      setRev((n) => n + 1)
      if (fresh && !seen) { setSeen(true); onSeen?.(r.id) }
    }
  }

  return (
    <li ref={revealRef} id={`fb-${r.id}`} className={'admin-user fb-item' + (focus ? ' focus' : '') + (open ? ' open' : '')}>
      <button type="button" className="fb-item-toggle" onClick={toggle} aria-expanded={open}>
        <span className="fb-item-head">
          <span className="admin-ex-meta">{fmtFeedbackDate(r.created_at)}</span>
          <span className="fb-item-tags">
            {fresh && !seen && <span className="act-badge">новый</span>}
            <span className={`fb-status s-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
            <Chevron className="fb-item-chev" open={open} />
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
                {shots > 0 && <span aria-label={`Вложений: ${shots}`}><Icon name="clip" size={13} /> {shots}</span>}
                {adds > 0 && <span aria-label={`Дополнений: ${adds}`}><Icon name="plus" size={13} /> {adds}</span>}
              </span>
            )}
          </>
        )}
      </button>
      {open && (
        <>
          <p className="fb-body">{r.body}</p>
          {/* Вложения по месту (fb_37f0c1a8): приложенное с дополнением — под ним, а не общим блоком. */}
          {r.screenshot_count > 0 ? <FeedbackPhotos id={r.id} kind="screenshots" indices={groups.base}
            load={api.media} lazy disabled={!online} label="Вложение к обращению" />
            : r.has_screenshot && <span className="admin-ex-meta"><Icon name="clip" size={13} /> со скриншотом</span>}
          {r.additions?.map((a) => (
            <div key={a.n}>
              <p className="fb-addition">
                <span aria-hidden="true">➕ </span>{a.body}
                <span className="admin-ex-meta"> · {fmtFeedbackDate(a.created_at)}</span>
              </p>
              {groups.byAddition[a.n] && <FeedbackPhotos id={r.id} kind="screenshots" indices={groups.byAddition[a.n]}
                load={api.media} lazy disabled={!online} label="Вложение к дополнению" />}
            </div>
          ))}
          {groups.later.length > 0 && <FeedbackPhotos id={r.id} kind="screenshots" indices={groups.later}
            load={api.media} lazy disabled={!online} label={laterLabel(r.screenshot_times, groups.later)} />}
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
              placeholder="Например: на экране Ленты то же самое"
              sendLabel="Дописать"
              max={APPEND_MAX}
              problem={appendProblem}
              send={(note) => api.append(r.id, note)}
              done={{ icon: 'plus', title: 'Дополнение отправлено', sub: 'Разработчик увидит его в том же обращении.' }}
              online={online}
              onDone={onReload}
              attach={attachTo(true)}
            />
          )}
          {canReopen(r) && (
            <FeedbackNoteForm
              openLabel="Не помогло — открыть снова"
              openClass="fb-reopen-again"
              label="Что не так?"
              placeholder="Например: после обновления подход все равно пропадает"
              sendLabel="Открыть снова"
              max={REOPEN_MAX}
              problem={reopenProblem}
              send={(note) => api.reopen(r.id, note)}
              done={{ icon: 'repeat', title: 'Обращение открыто снова', sub: 'Разработчик увидит твой комментарий.' }}
              online={online}
              onDone={onReload}
              attach={attachTo(false)}
            />
          )}
        </>
      )}
    </li>
  )
}
