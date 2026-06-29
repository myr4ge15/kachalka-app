import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getAllExercisesForAdmin } from '../db/repo.js'
import { useSyncStatus } from '../db/sync.js'
import { findExactDuplicate } from '../lib/similar.js'
import {
  adminListUsers, adminSetUser, adminSetPrivate, adminSetSex, adminResetPin, adminCreateUser,
  adminSetUserOrder, adminUpdateExercise, adminMergeExercise, AdminError,
} from '../lib/admin.js'
import { showToast } from '../components/Toast.jsx'

// Экран «Админка» (PLAN-admin). Виден только при role='admin' (вход из Профиля);
// сервер всё равно перепроверяет роль в каждой операции. Все мутации требуют
// сети — офлайн действия задизейблены с пояснением.
//
// Пропсы: user, onBack().
export default function AdminScreen({ user, onBack }) {
  const { online } = useSyncStatus()
  const exercises = useLiveQuery(() => getAllExercisesForAdmin(), [], [])

  // Разделы свёрнуты по умолчанию; раскрывается тот, что админ сам открыл (аккордеон).
  const [open, setOpen] = useState(null) // null | 'exercises' | 'users'
  const toggle = (key) => setOpen((cur) => (cur === key ? null : key))

  const errMsg = (e) => (e instanceof AdminError ? e.message : String(e?.message ?? e))

  return (
    <div className="screen admin">
      <div className="admin-head">
        <button className="admin-back" onClick={onBack} aria-label="Назад в профиль">‹ Профиль</button>
        <h2 className="admin-title">Админка</h2>
      </div>

      {!online && (
        <p className="admin-offline" role="status">
          Нет сети. Админ-операции доступны только онлайн.
        </p>
      )}

      <div className="admin-nav">
        <button
          className={'admin-nav-btn' + (open === 'exercises' ? ' open' : '')}
          onClick={() => toggle('exercises')}
          aria-expanded={open === 'exercises'}
        >
          <span className="admin-nav-name">Справочник упражнений</span>
          <span className="admin-nav-chev" aria-hidden="true">{open === 'exercises' ? '⌄' : '›'}</span>
        </button>
        {open === 'exercises' && (
          <div className="admin-panel">
            <ExercisesSection
              exercises={exercises ?? []}
              online={online}
              errMsg={errMsg}
            />
          </div>
        )}

        <button
          className={'admin-nav-btn' + (open === 'users' ? ' open' : '')}
          onClick={() => toggle('users')}
          aria-expanded={open === 'users'}
        >
          <span className="admin-nav-name">Пользователи</span>
          <span className="admin-nav-chev" aria-hidden="true">{open === 'users' ? '⌄' : '›'}</span>
        </button>
        {open === 'users' && (
          <div className="admin-panel">
            <UsersSection
              meId={user.id}
              online={online}
              errMsg={errMsg}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────── Упражнения ───────────────────────────────────
function ExercisesSection({ exercises, online, errMsg }) {
  const [query, setQuery] = useState('')
  const [edId, setEdId] = useState(null)
  const [form, setForm] = useState({ name: '', muscle_group: '', is_bench_lift: false, is_female_lift: false, is_hidden: false })
  const [busy, setBusy] = useState(false)

  // Слияние дублей
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mFrom, setMFrom] = useState('')
  const [mInto, setMInto] = useState('')
  const [mBusy, setMBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/ё/g, 'е')
    if (!q) return exercises
    return exercises.filter((e) => String(e.name ?? '').toLowerCase().replace(/ё/g, 'е').includes(q))
  }, [exercises, query])

  function openEdit(ex) {
    setEdId(ex.id)
    setForm({
      name: ex.name ?? '',
      muscle_group: ex.muscle_group ?? '',
      is_bench_lift: Boolean(ex.is_bench_lift),
      is_female_lift: Boolean(ex.is_female_lift),
      is_hidden: Boolean(ex.is_hidden),
    })
  }
  function closeEdit() { setEdId(null); setBusy(false) }

  async function save() {
    if (!online) { showToast({ emoji: '📡', title: 'Нужна сеть' }); return }
    setBusy(true)
    try {
      await adminUpdateExercise({ id: edId, ...form })
      showToast({ emoji: '✅', title: 'Упражнение обновлено' })
      closeEdit()
    } catch (e) {
      setBusy(false)
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
    }
  }

  // Быстрое скрыть/показать без открытия формы.
  async function toggleHidden(ex) {
    if (!online) { showToast({ emoji: '📡', title: 'Нужна сеть' }); return }
    try {
      await adminUpdateExercise({
        id: ex.id,
        name: ex.name,
        muscle_group: ex.muscle_group ?? '',
        is_bench_lift: Boolean(ex.is_bench_lift),
        is_female_lift: Boolean(ex.is_female_lift),
        is_hidden: !ex.is_hidden,
      })
      showToast({ emoji: ex.is_hidden ? '👁' : '🙈', title: ex.is_hidden ? 'Показано в пикере' : 'Скрыто из пикера' })
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
    }
  }

  // Подсветка вероятного дубля для строки слияния.
  const mergeDupHint = useMemo(() => {
    if (!mFrom) return null
    const from = exercises.find((e) => e.id === mFrom)
    if (!from) return null
    const dup = findExactDuplicate(from.name, exercises.filter((e) => e.id !== mFrom))
    return dup ? dup.id : null
  }, [mFrom, exercises])

  async function doMerge() {
    if (!online) { showToast({ emoji: '📡', title: 'Нужна сеть' }); return }
    setMBusy(true)
    try {
      await adminMergeExercise(mFrom, mInto)
      showToast({ emoji: '🔗', title: 'Дубль слит', sub: 'Старое упражнение скрыто.' })
      setMergeOpen(false); setMFrom(''); setMInto('')
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось слить', sub: errMsg(e) })
    } finally {
      setMBusy(false)
    }
  }

  return (
    <section className="sec">
      <input
        className="admin-search"
        type="search"
        placeholder="Поиск упражнения…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Поиск упражнения"
      />

      <ul className="admin-list">
        {filtered.map((ex) => (
          <li key={ex.id} className={'admin-ex' + (ex.is_hidden ? ' hidden' : '')}>
            {edId === ex.id ? (
              <div className="admin-ex-edit">
                <label className="field">
                  <span className="field-lab">Название</span>
                  <input
                    className="admin-input" type="text" maxLength={60}
                    value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </label>
                <label className="field">
                  <span className="field-lab">Группа мышц</span>
                  <input
                    className="admin-input" type="text" maxLength={40} placeholder="напр. грудь"
                    value={form.muscle_group} onChange={(e) => setForm((f) => ({ ...f, muscle_group: e.target.value }))}
                  />
                </label>
                <label className="admin-check">
                  <input type="checkbox" checked={form.is_bench_lift}
                    onChange={(e) => setForm((f) => ({ ...f, is_bench_lift: e.target.checked }))} />
                  <span>Жим лёжа — мужской лидерборд ⭐</span>
                </label>
                <label className="admin-check">
                  <input type="checkbox" checked={form.is_female_lift}
                    onChange={(e) => setForm((f) => ({ ...f, is_female_lift: e.target.checked }))} />
                  <span>Женский лидерборд (ягодичный мостик) 🍑</span>
                </label>
                <label className="admin-check">
                  <input type="checkbox" checked={form.is_hidden}
                    onChange={(e) => setForm((f) => ({ ...f, is_hidden: e.target.checked }))} />
                  <span>Скрыть из пикера</span>
                </label>
                <div className="admin-ex-actions">
                  <button className="btn ghost" onClick={closeEdit} disabled={busy}>Отмена</button>
                  <button className="btn primary" onClick={save} disabled={busy || !online}>
                    {busy ? 'Сохраняю…' : 'Сохранить'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="admin-ex-row">
                <div className="admin-ex-main">
                  <span className="admin-ex-name">
                    {ex.is_bench_lift && <span className="admin-star" title="Жим — мужской лидерборд">⭐</span>}
                    {ex.is_female_lift && <span className="admin-star" title="Женский лидерборд">🍑</span>}
                    {ex.name}
                  </span>
                  <span className="admin-ex-meta">
                    {ex.muscle_group || '—'}
                    {ex.is_custom ? ' · своё' : ''}
                    {ex.is_hidden ? ' · скрыто' : ''}
                  </span>
                </div>
                <div className="admin-ex-btns">
                  <button className="admin-mini" onClick={() => openEdit(ex)} aria-label="Изменить">✎</button>
                  <button className="admin-mini" onClick={() => toggleHidden(ex)} disabled={!online}
                    aria-label={ex.is_hidden ? 'Показать' : 'Скрыть'}>
                    {ex.is_hidden ? '👁' : '🙈'}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {filtered.length === 0 && <li className="muted">Ничего не найдено.</li>}
      </ul>

      {/* Слияние дублей */}
      {mergeOpen ? (
        <div className="admin-merge">
          <p className="admin-merge-title">Слить дубль</p>
          <label className="field">
            <span className="field-lab">Что слить (скроется)</span>
            <select className="prog-select" value={mFrom} onChange={(e) => setMFrom(e.target.value)}>
              <option value="">— выбери —</option>
              {exercises.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.is_hidden ? ' (скрыто)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-lab">Во что слить (останется)</span>
            <select className="prog-select" value={mInto} onChange={(e) => setMInto(e.target.value)}>
              <option value="">— выбери —</option>
              {exercises.filter((e) => e.id !== mFrom).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{mergeDupHint === e.id ? ' · похоже на дубль' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="admin-hint">
            Все тренировки и шаблоны со старого упражнения переедут на новое, старое скроется.
            Действие необратимо из интерфейса.
          </p>
          <div className="admin-ex-actions">
            <button className="btn ghost" onClick={() => setMergeOpen(false)} disabled={mBusy}>Отмена</button>
            <button className="btn danger" onClick={doMerge} disabled={mBusy || !online || !mFrom || !mInto}>
              {mBusy ? 'Сливаю…' : 'Слить'}
            </button>
          </div>
        </div>
      ) : (
        <button className="admin-add-link" onClick={() => setMergeOpen(true)}>🔗 Слить дубль упражнений</button>
      )}
    </section>
  )
}

// ─────────────────────────── Пользователи ─────────────────────────────────
function UsersSection({ meId, online, errMsg }) {
  const [users, setUsers] = useState(null)
  const [loadErr, setLoadErr] = useState('')

  // редактирование имени/роли
  const [edId, setEdId] = useState(null)
  const [edName, setEdName] = useState('')
  const [edRole, setEdRole] = useState('member')
  const [edPrivate, setEdPrivate] = useState(false)
  const [edSex, setEdSex] = useState('') // '' | 'm' | 'f'
  const [edBusy, setEdBusy] = useState(false)

  // сброс PIN
  const [pinForId, setPinForId] = useState(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [shownPin, setShownPin] = useState(null) // { id, pin }

  // порядок учёток на экране входа (drag-and-drop)
  const [reorder, setReorder] = useState(false)

  // добавить участника
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addRole, setAddRole] = useState('member')
  const [addPin, setAddPin] = useState('')
  const [addPrivate, setAddPrivate] = useState(false)
  const [addSex, setAddSex] = useState('') // '' | 'm' | 'f'
  const [addBusy, setAddBusy] = useState(false)

  const onlyDigits = (s) => s.replace(/\D/g, '').slice(0, 4)

  async function reload() {
    setLoadErr('')
    try {
      const list = await adminListUsers()
      setUsers(list)
    } catch (e) {
      setLoadErr(errMsg(e))
      setUsers([])
    }
  }
  useEffect(() => { if (online) reload(); else setUsers([]) /* офлайн — без RPC */ }, [online])

  function openEdit(u) {
    setEdId(u.id); setEdName(u.name ?? ''); setEdRole(u.role ?? 'member')
    setEdPrivate(Boolean(u.is_private))
    setEdSex(u.sex === 'm' || u.sex === 'f' ? u.sex : '')
  }
  function closeEdit() { setEdId(null); setEdBusy(false) }

  async function saveUser() {
    setEdBusy(true)
    try {
      await adminSetUser(edId, edName, edRole)
      await adminSetPrivate(edId, edPrivate)
      await adminSetSex(edId, edSex || null)
      showToast({ emoji: '✅', title: 'Участник обновлён' })
      closeEdit()
      reload()
    } catch (e) {
      setEdBusy(false)
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
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

  async function addUser() {
    setAddBusy(true)
    try {
      const u = await adminCreateUser(addName, addRole, addPin)
      // Приватность/пол ставим отдельными шагами (создание идёт через Edge
      // Function, флаги — через RPC), чтобы не трогать серверную функцию создания.
      if (addPrivate) await adminSetPrivate(u.id, true)
      if (addSex) await adminSetSex(u.id, addSex)
      showToast({ emoji: '🎉', title: 'Участник добавлен', sub: `${u.name} может входить PIN ${addPin}.` })
      setAddOpen(false); setAddName(''); setAddRole('member'); setAddPin(''); setAddPrivate(false); setAddSex('')
      reload()
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
    } finally {
      setAddBusy(false)
    }
  }

  return (
    <section className="sec">
      {loadErr && <p className="admin-offline" role="alert">{loadErr}</p>}
      {users === null && <p className="muted">Загрузка…</p>}

      {reorder ? (
        <UserReorderList
          users={users ?? []}
          meId={meId}
          onCancel={() => setReorder(false)}
          onSave={async (ids) => {
            await adminSetUserOrder(ids)
            showToast({ emoji: '↕️', title: 'Порядок сохранён', sub: 'Так учётки идут на экране входа.' })
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
                    <option value="m">М · жим лёжа</option>
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
                    {u.id === meId && <span className="admin-you">вы</span>}
                  </span>
                  <span className="admin-ex-meta">
                    {u.role === 'admin' ? 'админ' : 'участник'}
                    {(u.sex === 'f' || u.sex === 'm') && (
                      <> · <span className="admin-sex">{u.sex === 'f' ? '♀' : '♂'}</span></>
                    )}
                    {u.is_private ? ' · 🔒 приватный' : ''}
                  </span>
                </div>
                <div className="admin-ex-btns">
                  <button className="admin-mini" onClick={() => openEdit(u)} disabled={!online} aria-label="Изменить">✎</button>
                  <button className="admin-mini" onClick={() => resetPin(u)}
                    disabled={!online || (pinBusy && pinForId === u.id)} aria-label="Сбросить PIN">🔑</button>
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
              <option value="m">М · жим лёжа</option>
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

// Перетаскивание учёток для задания порядка на экране входа. Pointer Events
// (работает на тач-экранах: setPointerCapture + touch-action:none на ручке).
// Порядок мутируется локально при перетаскивании, на сервер уходит одним RPC.
function UserReorderList({ users, meId, onCancel, onSave, errMsg }) {
  const [order, setOrder] = useState(users)
  const [dragId, setDragId] = useState(null)
  const [busy, setBusy] = useState(false)
  const orderRef = useRef(order)
  const rowEls = useRef({})
  useEffect(() => { orderRef.current = order }, [order])

  function startDrag(e, id) {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* нет capture — ок */ }
    setDragId(id)
  }
  function onMove(e) {
    if (dragId == null) return
    const y = e.clientY
    const cur = orderRef.current
    let target = cur.length - 1
    for (let i = 0; i < cur.length; i++) {
      const el = rowEls.current[cur[i].id]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (y < r.top + r.height / 2) { target = i; break }
    }
    const from = cur.findIndex((u) => u.id === dragId)
    if (from !== -1 && from !== target) setOrder(moveItem(cur, from, target))
  }
  function endDrag(e) {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ок */ }
    setDragId(null)
  }

  const changed = order.some((u, i) => u.id !== users[i]?.id)

  async function save() {
    setBusy(true)
    try {
      await onSave(order.map((u) => u.id))
    } catch (e) {
      setBusy(false)
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
    }
  }

  return (
    <div className="user-reorder">
      <p className="admin-hint">Перетащи за ☰, чтобы задать порядок учёток на экране входа.</p>
      <ul className="admin-list reorder">
        {order.map((u) => (
          <li
            key={u.id}
            ref={(el) => { rowEls.current[u.id] = el }}
            className={'admin-user reorder-row' + (dragId === u.id ? ' dragging' : '')}
          >
            <span
              className="user-drag-handle"
              onPointerDown={(e) => startDrag(e, u.id)}
              onPointerMove={onMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="button"
              aria-label={`Перетащить ${u.name}`}
            >☰</span>
            <span className="admin-ex-name">
              {u.name}
              {u.id === meId && <span className="admin-you">вы</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="admin-ex-actions">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button className="btn primary" onClick={save} disabled={busy || !changed}>
          {busy ? 'Сохраняю…' : 'Сохранить порядок'}
        </button>
      </div>
    </div>
  )
}

function moveItem(arr, from, to) {
  const a = [...arr]
  const [x] = a.splice(from, 1)
  a.splice(to, 0, x)
  return a
}
