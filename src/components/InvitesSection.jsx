import { useEffect, useRef, useState } from 'react'
import { adminCreateInvite, adminListInvites, adminRevokeInvite } from '../lib/admin.js'
import { inviteUrl, inviteListLabel, inviteMessage } from '../lib/invite.js'
import { showToast } from './Toast.jsx'
import CardsSkeleton from './CardsSkeleton.jsx'
const adminApi = { create: adminCreateInvite, list: adminListInvites, revoke: adminRevokeInvite }

export default function InvitesSection({ online, errMsg, api = adminApi, limit = null }) {
  const [list, setList] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState(null) // { id, url, note, expiresAt }
  const [revId, setRevId] = useState(null)
  const alive = useRef(true)
  const operation = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function reload() {
    if (!alive.current) return
    setLoadErr('')
    try {
      const rows = await api.list()
      if (alive.current) setList(rows)
    } catch (e) {
      if (!alive.current) return
      setLoadErr(errMsg(e))
      setList([])
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (online) reload(); else setList([]) }, [online])

  async function create() {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    try {
      const inv = await api.create(note)
      const url = inviteUrl(inv.token, window.location.origin, import.meta.env.BASE_URL)
      if (alive.current) { setFresh({ id: inv.id, url, note: note.trim(), expiresAt: inv.expires_at }); setNote('') }
      await reload()
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
    } finally {
      operation.current = false
      if (alive.current) setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteMessage(fresh))
      showToast({ emoji: '📋', title: 'Приглашение скопировано', sub: 'Текст со ссылкой — вставь в чат.' })
    } catch {
      showToast({ emoji: '⚠️', title: 'Не скопировалось', sub: 'Выдели ссылку и скопируй вручную.' })
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'Журнал тренировок', text: inviteMessage({ expiresAt: fresh.expiresAt }), url: fresh.url })
    } catch { /* закрыли меню «Поделиться» — ничего не делаем */ }
  }

  async function revoke(inv) {
    if (operation.current) return
    operation.current = true
    setRevId(inv.id)
    try {
      await api.revoke(inv.id)
      if (alive.current && fresh?.id === inv.id) setFresh(null)
      showToast({ emoji: '⛔', title: 'Ссылка отозвана' })
      await reload()
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
    } finally {
      operation.current = false
      if (alive.current) setRevId(null)
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <section className="sec invite-sec">
      {!online && <p role="status">Для приглашения участника нужен интернет.</p>}
      {limit && <p className="admin-hint">До {limit} активных ссылок одновременно. Использованная, отозванная или истёкшая ссылка освобождает место.</p>}
      <p className="admin-hint">
        Ссылка одноразовая и живет 7 дней. Человек откроет ее, сам придумает имя и PIN и сразу
        окажется в журнале — его увидят все, как и других участников.
      </p>

      {fresh ? (
        <div className="admin-add invite-fresh">
          <p className="admin-merge-title">Ссылка{fresh.note ? ` · ${fresh.note}` : ''}</p>
          <input className="admin-input invite-url" type="text" readOnly value={fresh.url}
            aria-label="Ссылка-приглашение" onFocus={(e) => e.target.select()} />
          <p className="admin-hint">
            Скопируется вместе с коротким приглашением. Ссылка видна только сейчас — потеряешь,
            отзови и создай новую.
          </p>
          <div className="invite-fresh-actions">
            <button className="btn primary" onClick={copy}>Скопировать</button>
            {canShare && <button className="btn ghost" onClick={share}>Поделиться</button>}
            <button className="btn ghost" onClick={() => setFresh(null)}>Готово</button>
          </div>
        </div>
      ) : (
        <div className="admin-add">
          <label className="field">
            <span className="field-lab">Для кого (пометка, необязательно)</span>
            <input className="admin-input" type="text" maxLength={60} placeholder="напр. Саша с работы"
              value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </label>
          <button className="btn primary" onClick={create} disabled={busy || revId !== null || !online || (limit !== null && (list === null || !!loadErr || list.filter(i => i.status === 'ok').length >= limit))}>
            {busy ? 'Создаю…' : 'Создать ссылку'}
          </button>
        </div>
      )}

      {loadErr && <div><p className="admin-offline" role="alert">{loadErr}</p><button className="btn ghost" onClick={reload} disabled={!online}>Повторить</button></div>}
      {list === null && <CardsSkeleton cards={2} />}
      {list?.length > 0 && (
        <ul className="admin-list">
          {list.map((inv) => (
            <li key={inv.id} className="admin-user">
              <div className="admin-user-row">
                <div className="admin-ex-main">
                  <span className="admin-ex-name">{inv.note || 'Без пометки'}</span>
                  <span className="admin-ex-meta">{limit && inv.status === 'used' ? '✅ Участник зарегистрировался' : inviteListLabel(inv)}</span>
                </div>
                {inv.status === 'ok' && (
                  <div className="admin-ex-btns">
                    <button className="admin-mini" onClick={() => revoke(inv)}
                      disabled={!online || busy || revId !== null} aria-label="Отозвать ссылку">⛔</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {limit && <button className="btn ghost" onClick={reload} disabled={!online || busy || revId !== null}>Обновить список</button>}
    </section>
  )
}

