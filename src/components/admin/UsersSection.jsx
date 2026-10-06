// Секция Админки «Пользователи» (вынесена из screens/AdminScreen.jsx, v6.14.1).
import { useEffect, useRef, useState } from 'react'
import { adminListUsers, adminSetUser, adminSetPrivate, adminSetSex, adminResetPin, adminCreateUser, adminDeleteUser, adminSetUserOrder } from '../../lib/admin.js'
import { onlyDigits } from '../../lib/text.js'
import { showToast } from '../Toast.jsx'
import CardsSkeleton from '../CardsSkeleton.jsx'
import PencilIcon from '../PencilIcon.jsx'
import UserReorderList from './UserReorderList.jsx'

// ─────────────────────────── Пользователи ─────────────────────────────────
export default function UsersSection({ meId, online, errMsg }) {
  const [users, setUsers] = useState(null)
  const [loadErr, setLoadErr] = useState('')

  // редактирование имени/роли
  const [edId, setEdId] = useState(null)
  const [edName, setEdName] = useState('')
  const [edRole, setEdRole] = useState('member')
  const [edPrivate, setEdPrivate] = useState(false)
  const [edSex, setEdSex] = useState('') // '' | 'm' | 'f'
  // Снимок значений на момент открытия формы: сохраняем только РЕАЛЬНО измененное.
  // Мина, из-за которой у всех слетел пол (29.07.2026): если серверный
  // admin_list_users отдает список БЕЗ колонки sex (такая редакция функции лежит в
  // admin.sql / private-user.sql / user-order.sql, и перезапуск любого из них молча
  // откатывает контракт), то u.sex === undefined → edSex '' → безусловный
  // adminSetSex(edId, null) затирал пол в БД на каждом «Сохранить». В addUser это
  // защищено (`if (addSex)`), в saveUser защиты не было.
  const [edInit, setEdInit] = useState({ name: '', role: 'member', priv: false, sex: '' })
  const [edBusy, setEdBusy] = useState(false)

  // сброс PIN
  const [pinForId, setPinForId] = useState(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [shownPin, setShownPin] = useState(null) // { id, pin }

  // удаление участника
  const [deleteUser, setDeleteUser] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  // порядок учеток на экране входа (drag-and-drop)
  const [reorder, setReorder] = useState(false)

  // добавить участника
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addRole, setAddRole] = useState('member')
  const [addPin, setAddPin] = useState('')
  const [addPrivate, setAddPrivate] = useState(false)
  const [addSex, setAddSex] = useState('') // '' | 'm' | 'f'
  const [addBusy, setAddBusy] = useState(false)

  // Guard от setState после размонтирования (секцию можно свернуть на лету, пока
  // RPC в полете) — как в Login/Profile. Иначе React варнит «update on unmounted».
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  async function reload() {
    setLoadErr('')
    try {
      const list = await adminListUsers()
      if (alive.current) setUsers(list)
    } catch (e) {
      if (!alive.current) return
      setLoadErr(errMsg(e))
      setUsers([])
    }
  }
  // Перезагрузка ТОЛЬКО на смену online — `reload` вне deps намеренно (см. выше:
  // пересоздается каждый рендер, тот же fetch, stale-сеты гасит alive-ref).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (online) reload(); else setUsers([]) /* офлайн — без RPC */ }, [online])

  function openEdit(u) {
    const name = u.name ?? ''
    const role = u.role ?? 'member'
    const priv = Boolean(u.is_private)
    const sex = u.sex === 'm' || u.sex === 'f' ? u.sex : ''
    setEdId(u.id); setEdName(name); setEdRole(role)
    setEdPrivate(priv)
    setEdSex(sex)
    setEdInit({ name, role, priv, sex })
  }
  function closeEdit() { setEdId(null); setEdBusy(false) }

  async function saveUser() {
    setEdBusy(true)
    try {
      // Три отдельных RPC (имя/роль → приватность → пол): единого серверного вызова
      // нет. Если поздний упадет, ранние уже закоммичены — форма показала бы
      // устаревшее «все как ввели». Поэтому в catch зовем reload(): UI отразит
      // РЕАЛЬНОЕ частичное состояние сервера (см. РЕВЬЮ-КОДА-2026-07-13).
      // Зовем только РЕАЛЬНО измененное. Холостые RPC не безвредны: они двигают
      // users.updated_at (триггер trg_touch_users → лишний refetch ростера у всех
      // устройств), сорят в audit_log, а в случае пола еще и ЗАТИРАЛИ значение,
      // которого сервер не отдал в списке (см. edInit выше).
      if (edName.trim() !== edInit.name.trim() || edRole !== edInit.role) {
        await adminSetUser(edId, edName, edRole)
      }
      if (edPrivate !== edInit.priv) await adminSetPrivate(edId, edPrivate)
      if (edSex !== edInit.sex) await adminSetSex(edId, edSex || null)
      showToast({ emoji: '✅', title: 'Участник обновлен' })
      if (alive.current) closeEdit()
      reload()
    } catch (e) {
      if (alive.current) setEdBusy(false)
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
      reload() // часть шагов могла примениться — подтягиваем реальное состояние
    }
  }

  async function resetPin(u) {
    setPinForId(u.id); setPinBusy(true); setShownPin(null)
    try {
      const pin = await adminResetPin(u.id) // сервер сгенерит
      setShownPin({ id: u.id, pin })
      showToast({ emoji: '🔑', title: 'PIN сброшен', sub: 'Передай новый PIN человеку.' })
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
    } finally {
      setPinBusy(false); setPinForId(null)
    }
  }

  async function removeUser() {
    if (!deleteUser || !online) return

    setDeleteBusy(true)

    try {
      await adminDeleteUser(deleteUser.id)

      showToast({
        emoji: '🗑️',
        title: 'Участник удалён',
        sub: deleteUser.name,
      })

      if (alive.current) {
        setDeleteUser(null)
        setDeleteConfirm('')
      }

      reload()
    } catch (e) {
      showToast({
        emoji: '⚠️',
        title: 'Не удалось удалить',
        sub: errMsg(e),
      })

      reload()
    } finally {
      if (alive.current) setDeleteBusy(false)
    }
  }

  async function addUser() {
    setAddBusy(true)
    try {
      const u = await adminCreateUser(addName, addRole, addPin)
      // Приватность/пол ставим отдельными шагами (создание идет через Edge
      // Function, флаги — через RPC), чтобы не трогать серверную функцию создания.
      if (addPrivate) await adminSetPrivate(u.id, true)
      if (addSex) await adminSetSex(u.id, addSex)
      showToast({ emoji: '🎉', title: 'Участник добавлен', sub: `${u.name} может входить PIN ${addPin}.` })
      if (alive.current) { setAddOpen(false); setAddName(''); setAddRole('member'); setAddPin(''); setAddPrivate(false); setAddSex('') }
      reload()
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
      // Учетка могла создаться, а флаги (приватность/пол) — упасть: подтягиваем
      // список, чтобы UI показал реально созданного участника (не пустую форму).
      reload()
    } finally {
      if (alive.current) setAddBusy(false)
    }
  }

  return (
    <section className="sec">
      {loadErr && <p className="admin-offline" role="alert">{loadErr}</p>}
      {users === null && <CardsSkeleton cards={4} />}

      {reorder ? (
        <UserReorderList
          users={users ?? []}
          meId={meId}
          onCancel={() => setReorder(false)}
          onSave={async (ids) => {
            await adminSetUserOrder(ids)
            showToast({ emoji: '↕️', title: 'Порядок сохранен', sub: 'Так учетки идут на экране входа.' })
            setReorder(false)
            reload()
          }}
          errMsg={errMsg}
        />
      ) : (
      <>
      <ul className="admin-list">
        {(users ?? []).map((u) => (
          <li key={u.id} className="admin-user">
            {edId === u.id ? (
              <div className="admin-user-edit">
                <label className="field">
                  <span className="field-lab">Имя</span>
                  <input className="admin-input" type="text" maxLength={40}
                    value={edName} onChange={(e) => setEdName(e.target.value)} />
                </label>
                <label className="field">
                  <span className="field-lab">Роль</span>
                  <select className="prog-select" value={edRole} onChange={(e) => setEdRole(e.target.value)}>
                    <option value="member">участник</option>
                    <option value="admin">админ</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-lab">Пол (для лидерборда)</span>
                  <select className="prog-select" value={edSex} onChange={(e) => setEdSex(e.target.value)}>
                    <option value="">не задан (жим)</option>
                    <option value="m">М · жим лежа</option>
                    <option value="f">Ж · ягодичный мостик</option>
                  </select>
                </label>
                <label className="admin-check">
                  <input type="checkbox" checked={edPrivate}
                    onChange={(e) => setEdPrivate(e.target.checked)} />
                  <span>Приватный (виден только себе и админу) 🔒</span>
                </label>
                <div className="admin-ex-actions">
                  <button className="btn ghost" onClick={closeEdit} disabled={edBusy}>Отмена</button>
                  <button className="btn primary" onClick={saveUser} disabled={edBusy || !online}>
                    {edBusy ? 'Сохраняю…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="admin-user-row">
                <div className="admin-ex-main">
                  <span className="admin-ex-name">
                    {u.name}
                    {u.id === meId && <span className="admin-you">я</span>}
                  </span>
                  <span className="admin-ex-meta">
                    {u.role === 'admin' ? 'админ' : 'участник'}
                    {(u.sex === 'f' || u.sex === 'm') && (
                      <> · <span className="admin-sex">{u.sex === 'f' ? '♀︎' : '♂︎'}</span></>
                    )}
                    {u.is_private ? ' · 🔒 приватный' : ''}
                  </span>
                </div>
                <div className="admin-ex-btns">
                  <button className="admin-mini" onClick={() => openEdit(u)} disabled={!online} aria-label="Изменить"><PencilIcon size={16} /></button>
                  <button className="admin-mini" onClick={() => resetPin(u)}
                    disabled={!online || (pinBusy && pinForId === u.id)} aria-label="Сбросить PIN">🔑</button>
                  {u.id !== meId && <button className="admin-mini" onClick={() => { setDeleteUser(u); setDeleteConfirm('') }} disabled={!online} aria-label={`Удалить ${u.name}`} title="Удалить участника">🗑️</button>}
                </div>
              </div>
            )}
            {shownPin?.id === u.id && (
              <div className="admin-pin-shown">
                Новый PIN: <b>{shownPin.pin}</b>
                <button className="admin-mini" onClick={() => setShownPin(null)} aria-label="Скрыть">✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {deleteUser && (
        <div className="admin-merge">
          <p className="admin-merge-title">Удалить участника?</p>
          <p className="admin-hint">
            Будет удалена учётная запись <b>{deleteUser.name}</b>, её тренировки,
            цели, реакции и связанные пользовательские данные.
            Публичные шаблоны и созданные упражнения останутся без владельца.
          </p>

          <label className="field">
            <span className="field-lab">
              Для подтверждения введи имя: {deleteUser.name}
            </span>
            <input
              className="admin-input"
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              disabled={deleteBusy}
              autoComplete="off"
            />
          </label>

          <div className="admin-ex-actions">
            <button
              className="btn ghost"
              onClick={() => {
                setDeleteUser(null)
                setDeleteConfirm('')
              }}
              disabled={deleteBusy}
            >
              Отмена
            </button>
            <button
              className="btn danger"
              onClick={removeUser}
              disabled={
                deleteBusy ||
                !online ||
                deleteConfirm.trim() !== deleteUser.name.trim()
              }
            >
              {deleteBusy ? 'Удаляю…' : 'Удалить навсегда'}
            </button>
          </div>
        </div>
      )}

      {addOpen ? (
        <div className="admin-add">
          <p className="admin-merge-title">Новый участник</p>
          <label className="field">
            <span className="field-lab">Имя</span>
            <input className="admin-input" type="text" maxLength={40}
              value={addName} onChange={(e) => setAddName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-lab">Роль</span>
            <select className="prog-select" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
              <option value="member">участник</option>
              <option value="admin">админ</option>
            </select>
          </label>
          <label className="field">
            <span className="field-lab">Стартовый PIN (4 цифры)</span>
            <input className="pin-input" type="text" inputMode="numeric" placeholder="••••"
              value={addPin} onChange={(e) => setAddPin(onlyDigits(e.target.value))} />
          </label>
          <label className="field">
            <span className="field-lab">Пол (для лидерборда)</span>
            <select className="prog-select" value={addSex} onChange={(e) => setAddSex(e.target.value)}>
              <option value="">не задан (жим)</option>
              <option value="m">М · жим лежа</option>
              <option value="f">Ж · ягодичный мостик</option>
            </select>
          </label>
          <label className="admin-check">
            <input type="checkbox" checked={addPrivate}
              onChange={(e) => setAddPrivate(e.target.checked)} />
            <span>Приватный (виден только себе и админу) 🔒</span>
          </label>
          <div className="admin-ex-actions">
            <button className="btn ghost" onClick={() => setAddOpen(false)} disabled={addBusy}>Отмена</button>
            <button className="btn primary" onClick={addUser}
              disabled={addBusy || !online || addName.trim().length < 1 || addPin.length !== 4}>
              {addBusy ? 'Создаю…' : 'Добавить'}
            </button>
          </div>
        </div>
      ) : (
        <button className="admin-add-link" onClick={() => setAddOpen(true)} disabled={!online}>
          + Добавить участника
        </button>
      )}

      {(users?.length ?? 0) > 1 && (
        <button className="admin-add-link" onClick={() => setReorder(true)} disabled={!online}>
          ↕️ Порядок на экране входа
        </button>
      )}
      </>
      )}
    </section>
  )
}
