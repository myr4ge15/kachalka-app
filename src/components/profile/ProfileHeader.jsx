import { useState } from 'react'
import { setCachedAvatar, setCachedName } from '../../db/repo.js'
import { syncNow } from '../../db/sync.js'
import { setName, LoginError } from '../../lib/auth.js'
import { uploadMyAvatar } from '../../lib/avatar.js'
import { showToast } from '../Toast.jsx'
import Avatar from '../Avatar.jsx'
import PencilIcon from '../PencilIcon.jsx'
import { useAliveRef } from '../../hooks/useAliveRef.js'

// Шапка Профиля: аватар (смена по тапу) + имя (инлайн-редактор) + метка «админ»
// (фаза 2c; вынесено из ProfileScreen в v6.14.1).
// Пропсы: user {id,name,role}, avatarUrl, onRenamed(name).
export default function ProfileHeader({ user, avatarUrl, onRenamed }) {
  const aliveRef = useAliveRef()

  // ── Аватар ──
  const [avBusy, setAvBusy] = useState(false)
  async function onPickAvatar(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // позволить выбрать тот же файл повторно
    if (!file) return
    if (!navigator.onLine) {
      showToast({ emoji: '📷', title: 'Нужна сеть', sub: 'Аватар загружается онлайн.' })
      return
    }
    setAvBusy(true)
    try {
      const url = await uploadMyAvatar(user.id, file)
      await setCachedAvatar(user.id, url) // мгновенно обновить шапку/ЛК до pull
      showToast({ emoji: '📷', title: 'Аватар обновлен' })
    } catch (err) {
      showToast({ emoji: '⚠️', title: 'Не удалось загрузить', sub: String(err?.message ?? err) })
    } finally {
      if (aliveRef.current) setAvBusy(false)
    }
  }

  // ── Имя ──
  const [nameEditing, setNameEditing] = useState(false)
  const [nameVal, setNameVal] = useState('')
  const [nameErr, setNameErr] = useState('')
  const [nameBusy, setNameBusy] = useState(false)

  function openName() { setNameVal(user.name ?? ''); setNameErr(''); setNameEditing(true) }
  async function saveName() {
    setNameErr('')
    const clean = nameVal.trim()
    if (clean.length < 1 || clean.length > 40) { setNameErr('Имя — от 1 до 40 символов.'); return }
    if (clean === user.name) { setNameEditing(false); return }
    setNameBusy(true)
    try {
      const saved = await setName(user.id, clean)
      await setCachedName(user.id, saved) // пикер входа/кэш — сразу новое имя
      onRenamed?.(saved)                  // шапка + localStorage профиля
      if (aliveRef.current) setNameEditing(false)
      showToast({ emoji: '✏️', title: 'Имя обновлено' })
      // Имя в Ленте/лидерборде приходит join'ом с сервера — освежим на pull.
      if (navigator.onLine) syncNow(user.id)
    } catch (e) {
      if (aliveRef.current) setNameErr(e instanceof LoginError ? e.message : 'Не удалось сменить имя.')
    } finally {
      if (aliveRef.current) setNameBusy(false)
    }
  }

  return (
    <div className="prof-head">
      <label className={'avatar-edit' + (avBusy ? ' busy' : '')} title="Сменить аватар">
        <Avatar name={user.name} url={avatarUrl} className="avatar-lg" />
        <span className="avatar-cam" aria-hidden="true">{avBusy ? '…' : '📷'}</span>
        <input type="file" accept="image/*" onChange={onPickAvatar} disabled={avBusy} hidden />
      </label>
      <div className="prof-id">
        {nameEditing ? (
          <div className="name-editor">
            <input
              className="name-input"
              type="text"
              maxLength={40}
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              aria-label="Новое имя"
              autoFocus
            />
            {nameErr && <p className="name-err" role="alert">{nameErr}</p>}
            <div className="name-editor-actions">
              <button className="btn ghost" onClick={() => setNameEditing(false)} disabled={nameBusy}>Отмена</button>
              <button className="btn primary" onClick={saveName} disabled={nameBusy}>
                {nameBusy ? 'Сохраняю…' : 'Сохранить'}
              </button>
            </div>
          </div>
        ) : (
          <div className="prof-name">
            <span className="txt">{user.name}</span>
            <button className="name-edit" onClick={openName} aria-label="Изменить имя"><PencilIcon size={18} /></button>
          </div>
        )}
        {user.role === 'admin' && <span className="role-badge">админ</span>}
      </div>
    </div>
  )
}
