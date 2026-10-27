import Chevron from '../ui/Chevron.jsx'
import { useEffect, useRef, useState } from 'react'
import { adminCreateInvite, adminListInvites, adminRevokeInvite } from '../../lib/admin.js'
import { inviteUrl, inviteListLabel, inviteStatusIcon, inviteCreatorLabel, inviteMessage, splitInvites } from '../../lib/invite.js'
import { showToast } from '../ui/Toast.jsx'
import CardsSkeleton from '../ui/CardsSkeleton.jsx'
import Icon from '../ui/Icon.jsx'
const adminApi = { create: adminCreateInvite, list: adminListInvites, revoke: adminRevokeInvite }

// cache (v8.0.1) — кэш визита Админки (lib/adminCache.js), только для админских приглашений.
export default function InvitesSection({ online, errMsg, api = adminApi, limit = null, cache = null }) {
  const [list, setList] = useState(() => cache?.peek('invites') ?? null)
  const [loadErr, setLoadErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState(null) // { id, url, note, expiresAt }
  const [revId, setRevId] = useState(null)
  const alive = useRef(true)
  const operation = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function reload({ force = true } = {}) {
    if (!alive.current) return
    setLoadErr('')
    try {
      const rows = cache ? await cache.load('invites', () => api.list(), { force }) : await api.list()
      if (alive.current) setList(rows)
    } catch (e) {
      if (!alive.current) return
      setLoadErr(errMsg(e))
      setList([])
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (online) reload({ force: false }); else setList([]) }, [online])

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
      showToast({ icon: 'alert', title: 'Не удалось', sub: errMsg(e) })
    } finally {
      operation.current = false
      if (alive.current) setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteMessage(fresh))
      showToast({ icon: 'copy', title: 'Приглашение скопировано', sub: 'Текст со ссылкой — вставь в чат.' })
    } catch {
      showToast({ icon: 'alert', title: 'Не скопировалось', sub: 'Выдели ссылку и скопируй вручную.' })
    }
  }

  async function share() {
    try {
      // Ссылка — внутри текста, без отдельного url (v6.16.1): Телеграм, WhatsApp и др. при
      // заданном url берут только его и выкидывают text — друг получал голую ссылку.
      await navigator.share({ title: 'Журнал тренировок', text: inviteMessage(fresh) })
    } catch { /* закрыли меню «Поделиться» — ничего не делаем */ }
  }

  // Отзыв — со второго тапа (UI-ревью 23.10): ссылку не вернуть, а ⛔ легко задеть.
  const [armId, setArmId] = useState(null)
  async function revoke(inv) {
    if (armId !== inv.id) { setArmId(inv.id); return }
    setArmId(null)
    if (operation.current) return
    operation.current = true
    setRevId(inv.id)
    try {
      await api.revoke(inv.id)
      if (alive.current && fresh?.id === inv.id) setFresh(null)
      showToast({ icon: 'block', title: 'Ссылка отозвана' })
      await reload()
    } catch (e) {
      showToast({ icon: 'alert', title: 'Не удалось', sub: errMsg(e) })
    } finally {
      operation.current = false
      if (alive.current) setRevId(null)
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const { active, past, used } = splitInvites(list)

  const row = (inv) => (
    <li key={inv.id} className="admin-user">
      <div className="admin-user-row">
        <div className="admin-ex-main">
          <span className="admin-ex-name">{inv.note || 'Без пометки'}</span>
          <span className={`admin-ex-meta status-line status-line--${inv.status === 'ok' ? 'wait' : inv.status}`}>
            {inviteStatusIcon(inv.status) && <Icon name={inviteStatusIcon(inv.status)} size={14} className="status-line-icon" />}
            {limit && inv.status === 'used' ? 'Участник зарегистрировался' : inviteListLabel(inv)}
          </span>
          {/* Создатель — только в админском списке (там ссылки всех); в Профиле они свои. */}
          {limit === null && 'created_by_name' in inv && <span className="admin-ex-meta">{inviteCreatorLabel(inv)}</span>}
        </div>
        {inv.status === 'ok' && (
          <div className="admin-ex-btns">
            <button className={'admin-mini' + (armId === inv.id ? ' armed' : '')} onClick={() => revoke(inv)}
              disabled={!online || busy || revId !== null}
              aria-label={`${armId === inv.id ? 'Точно отозвать' : 'Отозвать'} ссылку «${inv.note || 'Без пометки'}»`}>
              {armId === inv.id ? 'Точно?' : <Icon name="block" size={18} />}
            </button>
          </div>
        )}
      </div>
    </li>
  )

  return (
    <section className="sec invite-sec">
      {!online && <p role="status">Для приглашения участника нужен интернет.</p>}
      {limit && <p className="admin-hint">До {limit} активных ссылок одновременно. Использованная, отозванная или истекшая ссылка освобождает место.</p>}
      <p className="admin-hint">
        Ссылка одноразовая и живет 7 дней. Человек откроет ее, сам придумает логин, PIN и имя и
        сразу станет твоим другом — вы будете видеть тренировки друг друга.
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
      {/* v8.2.1: действующие — сверху, история (отозванные, истекшие, по которым
          зарегистрировались) — свернута, иначе она росла и прятала действующие. */}
      {active.length > 0 && <ul className="admin-list" aria-label="Действующие ссылки">{active.map(row)}</ul>}
      {list !== null && !loadErr && active.length === 0 && past.length > 0 && (
        <p className="admin-hint">Действующих ссылок нет.</p>
      )}
      {limit && <button className="btn ghost" onClick={reload} disabled={!online || busy || revId !== null}>Обновить список</button>}
      {past.length > 0 && (
        <details className="invite-history">
          <summary>
            <span>История ссылок: {past.length}</span>
            {used > 0 && <span className="invite-history-used">зарегистрировались: {used}</span>}
            <Chevron size={18} className="invite-history-chev" />
          </summary>
          <ul className="admin-list">{past.map(row)}</ul>
        </details>
      )}
    </section>
  )
}

