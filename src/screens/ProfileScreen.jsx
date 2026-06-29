import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts, getCachedUser, setCachedAvatar, setCachedName, softDeleteMyWorkouts } from '../db/repo.js'
import { readGoals, writeGoals } from '../db/notifications.js'
import { syncNow } from '../db/sync.js'
import { getCachedLeaderboard } from '../db/leaderboard.js'
import { getMeta } from '../db/local.js'
import { summarize, currentBest, goalProgress } from '../lib/profileStats.js'
import { fmtMetricValue, isCountMetric } from '../lib/metric.js'
import { setPin, setName, LoginError } from '../lib/auth.js'
import { uploadMyAvatar } from '../lib/avatar.js'
import { showToast } from '../components/Toast.jsx'
import Avatar from '../components/Avatar.jsx'

// Экран «Профиль» (ЛК). Всё про самого пользователя; пер-упражненческую
// аналитику не дублируем — рекорды уводят в «Прогресс». Считаем на клиенте из
// уже имеющихся денормализованных тренировок. Цель (фаза 2b) дополнительно
// уходит на сервер при сохранении, чтобы достижение увидел Telegram-бот.
//
// Пропсы: user, onLogout, onOpenProgress(exerciseId), onOpenFeed().
export default function ProfileScreen({ user, onLogout, onOpenProgress, onOpenFeed, onRenamed, onOpenAdmin }) {
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const goals = useLiveQuery(() => readGoals(user.id), [user.id])
  const myCached = useLiveQuery(() => getCachedUser(user.id), [user.id])
  const loading = workouts === undefined

  const summary = useMemo(() => summarize(workouts ?? []), [workouts])
  const records = summary.personalRecords

  // Место в лидерборде по жиму (кэш Ленты/снимок). Только чтение, без запросов.
  const [place, setPlace] = useState(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      // Приватный в рейтинге не участвует — место не показываем.
      if (await getMeta(`priv_${user.id}`)) { if (alive) setPlace(null); return }
      try {
        const board = await getCachedLeaderboard()
        if (!alive) return
        const idx = board.findIndex((r) => r.user_id === user.id)
        setPlace(idx >= 0 ? idx + 1 : null)
      } catch { if (alive) setPlace(null) }
    })()
    return () => { alive = false }
    // Место в борде зависит от кэша лидерборда/ленты, а не от своих тренировок,
    // поэтому workouts в зависимостях не нужен (он лишь плодил лишние чтения).
    // Экран перемонтируется при входе в профиль — место и так пересчитывается.
  }, [user.id])

  // ── Редактор целей (мульти-цели, фаза 2c) ──────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [edExId, setEdExId] = useState(null)
  const [edWeight, setEdWeight] = useState(100)
  const [edIsNew, setEdIsNew] = useState(false) // добавляем новую (можно выбрать упражнение) или правим вес существующей

  // ── Смена PIN (фаза 2c) ─────────────────────────────────────────────────
  const [pinOpen, setPinOpen] = useState(false)
  const [curPin, setCurPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [rptPin, setRptPin] = useState('')
  const [pinErr, setPinErr] = useState('')
  const [pinBusy, setPinBusy] = useState(false)

  const onlyDigits = (s) => s.replace(/\D/g, '').slice(0, 4)

  function resetPinForm() {
    setCurPin(''); setNewPin(''); setRptPin(''); setPinErr(''); setPinBusy(false)
  }
  function closePinForm() { setPinOpen(false); resetPinForm() }

  async function submitPin() {
    setPinErr('')
    if (curPin.length !== 4 || newPin.length !== 4 || rptPin.length !== 4) {
      setPinErr('PIN — 4 цифры.'); return
    }
    if (newPin !== rptPin) { setPinErr('Новый PIN и повтор не совпадают.'); return }
    if (newPin === curPin) { setPinErr('Новый PIN совпадает с текущим.'); return }
    setPinBusy(true)
    try {
      await setPin(user.id, curPin, newPin)
      closePinForm()
      showToast({ emoji: '🔑', title: 'PIN обновлён', sub: 'Вход — уже новым PIN.' })
    } catch (e) {
      setPinBusy(false)
      setPinErr(e instanceof LoginError ? e.message : 'Не удалось сменить PIN.')
    }
  }

  // ── Аватар (фаза 2c) ────────────────────────────────────────────────────
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
      showToast({ emoji: '📷', title: 'Аватар обновлён' })
    } catch (err) {
      showToast({ emoji: '⚠️', title: 'Не удалось загрузить', sub: String(err?.message ?? err) })
    } finally {
      setAvBusy(false)
    }
  }

  // ── Смена имени (фаза 2c) ───────────────────────────────────────────────
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
      setNameEditing(false)
      showToast({ emoji: '✏️', title: 'Имя обновлено' })
      // Имя в Ленте/лидерборде приходит join'ом с сервера — освежим на pull.
      if (navigator.onLine) syncNow(user.id)
    } catch (e) {
      setNameErr(e instanceof LoginError ? e.message : 'Не удалось сменить имя.')
    } finally {
      setNameBusy(false)
    }
  }

  // ── Удалить мои данные (фаза 2c, soft-delete) ───────────────────────────
  const [delArm, setDelArm] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  async function confirmDelete() {
    setDelBusy(true)
    try {
      const n = await softDeleteMyWorkouts(user.id)
      setDelArm(false)
      showToast({
        emoji: '🗑',
        title: 'Данные удалены',
        sub: n ? `Помечено тренировок: ${n}` : 'Удалять было нечего.',
      })
      if (navigator.onLine) syncNow(user.id) // отправить удаления на сервер
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось удалить', sub: String(e?.message ?? e) })
    } finally {
      setDelBusy(false)
    }
  }

  // Видимые цели (без tombstone'ов) и упражнения, по которым цели ещё нет
  // (для пикера «добавить»). Имя редактируемой цели — из самого списка.
  const goalList = (goals ?? []).filter((g) => !g._deleted)
  // Цели — только весовые (в кг): не-весовые упражнения в пикер цели не предлагаем
  // (цели по повторам/времени — вне этого плана).
  const addOptions = records.filter(
    (r) => !isCountMetric(r.metric) && !goalList.some((g) => g.exerciseId === r.exId)
  )
  const edName = edExId
    ? (goalList.find((g) => g.exerciseId === edExId)?.exerciseName ??
       records.find((r) => r.exId === edExId)?.name ?? '—')
    : '—'

  // Открыть редактор: новая цель (выбор упражнения из ещё-без-цели) или правка
  // веса существующей (упражнение фиксировано).
  function openAddGoal() {
    if (addOptions.length === 0) {
      showToast({ emoji: '🎯', title: 'Цели уже на всех упражнениях' })
      return
    }
    const base = addOptions.find((r) => r.isBench) || addOptions[0]
    setEdIsNew(true)
    setEdExId(base?.exId ?? null)
    setEdWeight(base ? Math.max(base.value + 5, 20) : 100)
    setEditing(true)
  }
  function openEditGoal(g) {
    setEdIsNew(false)
    setEdExId(g.exerciseId)
    setEdWeight(g.targetWeight)
    setEditing(true)
  }

  async function saveGoal() {
    if (!edExId) return
    const ex = records.find((r) => r.exId === edExId)
    const target = Number(edWeight) || 0
    const list = await readGoals(user.id) // свежий массив (вкл. tombstone'ы)
    const idx = list.findIndex((g) => g.exerciseId === edExId)
    let next
    if (idx >= 0) {
      const prevW = Number(list[idx].targetWeight)
      next = list.map((g, i) =>
        i === idx
          ? {
              ...g,
              exerciseName: ex?.name ?? g.exerciseName ?? '—',
              targetWeight: target,
              _dirty: 1,
              _deleted: 0,
              // смена веса → цель можно достичь заново; вес тот же → не сбрасываем
              achievedAt: prevW !== target ? null : g.achievedAt ?? null,
            }
          : g
      )
    } else {
      next = [
        ...list,
        { exerciseId: edExId, exerciseName: ex?.name ?? '—', targetWeight: target, achievedAt: null, _dirty: 1 },
      ]
    }
    await writeGoals(user.id, next)
    setEditing(false)
    // Сразу пушим (если онлайн), чтобы бот увидел цель до ближайшей тренировки.
    if (navigator.onLine) syncNow(user.id)
  }

  // Удалить цель: tombstone (_deleted+_dirty) — синк отправит delete_my_goal и
  // выкинет её из массива; из списка пропадает сразу.
  async function deleteGoal(exerciseId) {
    const list = await readGoals(user.id)
    const next = list.map((g) =>
      g.exerciseId === exerciseId ? { ...g, _deleted: 1, _dirty: 1 } : g
    )
    await writeGoals(user.id, next)
    setEditing(false)
    if (navigator.onLine) syncNow(user.id)
  }

  return (
    <div className="screen profile">
      {/* шапка профиля */}
      <div className="prof-head">
        <label className={'avatar-edit' + (avBusy ? ' busy' : '')} title="Сменить аватар">
          <Avatar name={user.name} url={myCached?.avatar_url} className="avatar-lg" />
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
              <button className="name-edit" onClick={openName} aria-label="Изменить имя">✎</button>
            </div>
          )}
          {user.role === 'admin' && <span className="role-badge">админ</span>}
        </div>
      </div>

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && summary.totalWorkouts === 0 && (
        <p className="muted empty">
          Здесь будет твоя сводка: рекорды и цель. Запиши первую тренировку 💪
        </p>
      )}

      {!loading && summary.totalWorkouts > 0 && (
        <>
          {/* быстрые цифры */}
          <div className="stat-grid">
            <div className="stat-cell">
              <div className="stat-num">{summary.totalWorkouts}</div>
              <div className="stat-lab">тренировок<br />всего</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{summary.workoutsThisMonth}</div>
              <div className="stat-lab">за этот<br />месяц</div>
            </div>
          </div>

          {/* личные цели (мульти-цели) */}
          <section className="sec">
            <p className="sec-title">Мои цели</p>
            {editing ? (
              <div className="goal">
                <div className="goal-editor">
                  {edIsNew ? (
                    <label className="field">
                      <span className="field-lab">Упражнение</span>
                      <select
                        className="prog-select"
                        value={String(edExId ?? '')}
                        onChange={(e) => setEdExId(e.target.value)}
                      >
                        {addOptions.map((r) => (
                          <option key={r.exId} value={String(r.exId)}>
                            {r.name}{r.isBench ? ' ⭐' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="field">
                      <span className="field-lab">Упражнение</span>
                      <div className="goal-editor-ex">{edName}</div>
                    </div>
                  )}
                  <label className="field">
                    <span className="field-lab">Целевой вес</span>
                    <div className="goal-stepper">
                      <button
                        type="button"
                        onClick={() => setEdWeight((w) => Math.max(1.5, Math.round((Number(w) - 1.5) * 10) / 10))}
                      >−</button>
                      <span className="val">
                        <input
                          className="val-field"
                          type="text"
                          inputMode="decimal"
                          value={edWeight}
                          onChange={(e) =>
                            setEdWeight(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))
                          }
                          onBlur={() =>
                            setEdWeight((w) => {
                              const n = Number(w)
                              return n > 0 ? Math.round(n * 10) / 10 : 2.5
                            })
                          }
                          aria-label="Целевой вес в килограммах"
                        />
                        <span className="u">кг</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setEdWeight((w) => Math.round((Number(w) + 1.5) * 10) / 10)}
                      >+</button>
                    </div>
                  </label>
                  <div className="goal-editor-actions">
                    {!edIsNew && (
                      <button className="btn danger-ghost" onClick={() => deleteGoal(edExId)}>Удалить</button>
                    )}
                    <button className="btn ghost" onClick={() => setEditing(false)}>Отмена</button>
                    <button className="btn primary" onClick={saveGoal} disabled={!edExId}>Сохранить</button>
                  </div>
                </div>
              </div>
            ) : goalList.length === 0 ? (
              <div className="goal">
                <button className="goal-edit set" onClick={openAddGoal}>+ Поставить цель</button>
              </div>
            ) : (
              <div className="goals-list">
                {goalList.map((g) => {
                  const cur = currentBest(workouts ?? [], g.exerciseId)
                  const pct = goalProgress(cur, g.targetWeight)
                  const left = Math.max(0, Math.round((g.targetWeight - cur) * 10) / 10)
                  return (
                    <div className="goal" key={g.exerciseId}>
                      <div className="goal-top">
                        <span className="lbl">
                          {g.exerciseName} <b>{g.targetWeight} <span className="u">кг</span></b>
                        </span>
                        <span className="pct">{pct}%</span>
                      </div>
                      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                      {g.achievedAt ? (
                        <div className="goal-sub achieved">🎯 Цель достигнута!</div>
                      ) : (
                        <div className="goal-sub">текущий рекорд {cur} кг · осталось {left} кг</div>
                      )}
                      <button className="goal-edit" onClick={() => openEditGoal(g)}>✎ Изменить цель</button>
                    </div>
                  )
                })}
                <button className="goal-add" onClick={openAddGoal}>+ Добавить цель</button>
              </div>
            )}
          </section>

          {/* личные рекорды → Прогресс */}
          {records.length > 0 && (
            <section className="sec">
              <p className="sec-title">Личные рекорды · тап → Прогресс</p>
              <ul className="pr-list">
                {records.map((r) => (
                  <li key={r.exId}>
                    <button className="pr-row" onClick={() => onOpenProgress?.(r.exId)}>
                      <span className="pr-name">
                        <span className={'star' + (r.isBench ? '' : ' dim')}>★</span>
                        <span className="txt">{r.name}</span>
                      </span>
                      <span className="pr-val">
                        {fmtMetricValue(r.metric, r.value)} <span className="arr">›</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="hint">
                Графики по дням и «форма сейчас» — на экране «Прогресс».
              </p>
            </section>
          )}

          {/* любимое упражнение */}
          {summary.favExercise && (
            <section className="sec">
              <p className="sec-title">Любимое</p>
              <div className="info-row">
                <span className="em" aria-hidden="true">🔁</span>
                <div>
                  <div className="v">{summary.favExercise.name}</div>
                  <div className="k">чаще всего · {summary.favExercise.sets} подходов</div>
                </div>
              </div>
            </section>
          )}

          {/* мостик к лидерборду */}
          {place != null && (
            <section className="sec">
              <p className="sec-title">А на фоне друзей</p>
              <button className="leader-link" onClick={() => onOpenFeed?.()}>
                <div>
                  <div className="v">{place}-е место по жиму</div>
                  <div className="k">лидерборд живёт в Ленте</div>
                </div>
                <span className="go">Лента ›</span>
              </button>
            </section>
          )}
        </>
      )}

      {/* настройки и выход */}
      <section className="sec">
        <p className="sec-title">Настройки</p>
        <div className="actions">
          {pinOpen ? (
            <div className="pin-form">
              <p className="pin-form-title">Смена PIN</p>
              <label className="field">
                <span className="field-lab">Текущий PIN</span>
                <input
                  className="pin-input" type="password" inputMode="numeric"
                  autoComplete="current-password" placeholder="••••"
                  value={curPin} onChange={(e) => setCurPin(onlyDigits(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-lab">Новый PIN</span>
                <input
                  className="pin-input" type="password" inputMode="numeric"
                  autoComplete="new-password" placeholder="4 цифры"
                  value={newPin} onChange={(e) => setNewPin(onlyDigits(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-lab">Повтор нового PIN</span>
                <input
                  className="pin-input" type="password" inputMode="numeric"
                  autoComplete="new-password" placeholder="ещё раз"
                  value={rptPin} onChange={(e) => setRptPin(onlyDigits(e.target.value))}
                />
              </label>
              {pinErr && <p className="pin-err" role="alert">{pinErr}</p>}
              <div className="pin-form-actions">
                <button className="btn ghost" onClick={closePinForm} disabled={pinBusy}>Отмена</button>
                <button className="btn primary" onClick={submitPin} disabled={pinBusy}>
                  {pinBusy ? 'Сохраняю…' : 'Сменить PIN'}
                </button>
              </div>
            </div>
          ) : (
            <button className="act" onClick={() => setPinOpen(true)}>🔑 Сменить PIN</button>
          )}
          {user.role === 'admin' && (
            <button className="act" onClick={() => onOpenAdmin?.()}>🛠 Админка</button>
          )}
          {delArm ? (
            <div className="danger-confirm">
              <p className="danger-text">
                Удалить все свои тренировки? Восстановить можно только из бэкапа сервера.
                Учётная запись, цель и шаблоны останутся.
              </p>
              <div className="danger-actions">
                <button className="btn ghost" onClick={() => setDelArm(false)} disabled={delBusy}>Отмена</button>
                <button className="btn danger" onClick={confirmDelete} disabled={delBusy}>
                  {delBusy ? 'Удаляю…' : 'Да, удалить'}
                </button>
              </div>
            </div>
          ) : (
            <button className="act danger" onClick={() => setDelArm(true)}>🗑 Удалить мои данные</button>
          )}
          <button className="act logout" onClick={onLogout}>Выйти</button>
        </div>
      </section>

      {/* версия приложения — подставляется на сборке из package.json (vite define) */}
      <p className="app-version">kachalka-app · v{APP_VERSION}</p>
    </div>
  )
}

// Версия из package.json, прокинутая через vite define. Fallback на случай
// запуска без define (напр. тесты) — чтобы не падать на ReferenceError.
const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
