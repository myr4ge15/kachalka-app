import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  getWorkouts, getCachedUser, setCachedAvatar, setCachedName, softDeleteMyWorkouts,
  deadLetterCount, retryDeadLetter, discardDeadLetter,
  getProgSettings, setProgEnabled,
  getConnections, getUsers, requestConnection, acceptConnection, removeConnection,
} from '../db/repo.js'
import { deriveConnections } from '../lib/connections.js'
import { readGoals, writeGoals } from '../db/notifications.js'
import { syncNow } from '../db/sync.js'
import { getCachedLeaderboard } from '../db/leaderboard.js'
import { getMeta } from '../db/local.js'
import { summarize, currentBestValue, goalProgress, fmtTonnage } from '../lib/profileStats.js'
import { fmtMetricValue, normMetric, parseTime, fmtTime } from '../lib/metric.js'
import { setPin, setName, LoginError } from '../lib/auth.js'
import { uploadMyAvatar } from '../lib/avatar.js'
import { showToast } from '../components/Toast.jsx'
import HoldButton from '../components/HoldButton.jsx'
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
  // Тумблер автопрогрессии (рекомендации весов/повторов в тренировке).
  const progEnabled = useLiveQuery(() => getProgSettings(user.id).then((p) => p.enabled), [user.id], true)
  const loading = workouts === undefined

  const summary = useMemo(() => summarize(workouts ?? []), [workouts])
  const records = summary.personalRecords

  // Место в лидерборде в СВОЁМ борде (мужской — жим, женский — ягодичный мостик).
  // Кэш Ленты/снимок, только чтение. { n, board } | null.
  const [place, setPlace] = useState(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      // Приватный в рейтинге не участвует — место не показываем.
      if (await getMeta(`priv_${user.id}`)) { if (alive) setPlace(null); return }
      try {
        const board = await getCachedLeaderboard()
        if (!alive) return
        const inF = (board.female ?? []).findIndex((r) => r.user_id === user.id)
        const inM = (board.male ?? []).findIndex((r) => r.user_id === user.id)
        if (inF >= 0) setPlace({ n: inF + 1, board: 'f' })
        else if (inM >= 0) setPlace({ n: inM + 1, board: 'm' })
        else setPlace(null)
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
  // Цель любой метрики: edMetric — тип ('weight'/'reps'/'time'), edVal — целевое
  // ведущее значение в единицах метрики (кг / повторы / секунды). edTimeStr —
  // отдельная строка ввода для time (мм:сс), чтобы не реформатить при наборе.
  const [edMetric, setEdMetric] = useState('weight')
  const [edVal, setEdVal] = useState(100)
  const [edTimeStr, setEdTimeStr] = useState('1:00')
  // Необязательные повторы при целевом весе (PLAN-goal-reps) — только у весовой
  // цели. 0/'' → требования по повторам нет (старое поведение).
  const [edReps, setEdReps] = useState(0)
  const [edIsNew, setEdIsNew] = useState(false) // добавляем новую (можно выбрать упражнение) или правим цель существующей

  // Редактор рендерится инлайн в секции «Мои цели» (вверху экрана). Если открыть
  // его, проскроллив вниз (кнопка «+ Добавить цель»), форма встаёт на месте секции
  // — выше видимой области. Доводим форму до экрана после её появления.
  const editorRef = useRef(null)
  useEffect(() => {
    if (editing) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [editing])

  // Блок «Настройки» свёрнут по умолчанию: экран профиля длинный (статы + цели +
  // рекорды + настройки + danger-zone), редко используемые действия прячем.
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  // ── Застрявшие изменения (dead-letter) ─────────────────────────────────
  // Операции, провалившие все попытки отправки. Обычно — затянувшийся холодный
  // старт/обрыв; даём пересобрать или отклонить, чтобы не копились молча.
  const deadCount = useLiveQuery(() => deadLetterCount(), [], 0)
  const [dlBusy, setDlBusy] = useState(false)
  const [dlArm, setDlArm] = useState(false) // подтверждение «отклонить» (теряет правки)
  async function retryDead() {
    setDlBusy(true)
    try {
      const n = await retryDeadLetter()
      showToast({ emoji: '🔄', title: 'Повторная отправка', sub: `Операций в очереди: ${n}` })
      if (navigator.onLine) syncNow(user.id)
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: String(e?.message ?? e) })
    } finally {
      setDlBusy(false)
    }
  }
  async function discardDead() {
    setDlBusy(true)
    try {
      const n = await discardDeadLetter()
      setDlArm(false)
      showToast({ emoji: '🧹', title: 'Изменения отклонены', sub: `Удалено операций: ${n}` })
      if (navigator.onLine) syncNow(user.id)
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: String(e?.message ?? e) })
    } finally {
      setDlBusy(false)
    }
  }

  // Видимые цели (без tombstone'ов) и упражнения, по которым цели ещё нет
  // (для пикера «добавить»). Имя редактируемой цели — из самого списка.
  const goalList = (goals ?? []).filter((g) => !g._deleted)
  // Цели — по любой метрике (вес/повторы/время): предлагаем все упражнения из
  // рекордов, по которым цели ещё нет.
  const addOptions = records.filter(
    (r) => !goalList.some((g) => g.exerciseId === r.exId)
  )
  const edName = edExId
    ? (goalList.find((g) => g.exerciseId === edExId)?.exerciseName ??
       records.find((r) => r.exId === edExId)?.name ?? '—')
    : '—'

  // Разумный дефолт цели «чуть выше текущего» по метрике (base — текущий рекорд).
  function goalDefault(metric, base) {
    const b = Number(base) || 0
    const m = normMetric(metric)
    if (m === 'time') return Math.max(Math.round(b) + 15, 30)   // +15 с, минимум 0:30
    if (m === 'reps') return Math.max(Math.round(b) + 2, 5)     // +2 повтора, минимум 5
    return Math.max(b + 5, 20)                                  // +5 кг, минимум 20
  }
  // Установить редактируемое значение (секунды для time дублируем в строку мм:сс).
  function setEdValue(metric, v) {
    const m = normMetric(metric)
    const n = m === 'weight' ? v : Math.max(0, Math.round(Number(v) || 0))
    setEdVal(n)
    if (m === 'time') setEdTimeStr(fmtTime(n))
  }

  // Открыть редактор: новая цель (выбор упражнения из ещё-без-цели) или правка
  // существующей (упражнение фиксировано).
  function openAddGoal() {
    if (addOptions.length === 0) {
      showToast({ emoji: '🎯', title: 'Цели уже на всех упражнениях' })
      return
    }
    const base = addOptions.find((r) => r.isBench) || addOptions[0]
    const m = normMetric(base?.metric)
    setEdIsNew(true)
    setEdExId(base?.exId ?? null)
    setEdMetric(m)
    setEdValue(m, goalDefault(m, base?.value ?? 0))
    setEdReps(0) // повторы по умолчанию не требуем
    setEditing(true)
  }
  // Смена упражнения в пикере новой цели → подхватываем его метрику и дефолт.
  function chooseGoalExercise(exId) {
    const r = addOptions.find((x) => String(x.exId) === String(exId))
    const m = normMetric(r?.metric)
    setEdExId(r?.exId ?? exId)
    setEdMetric(m)
    setEdValue(m, goalDefault(m, r?.value ?? 0))
    setEdReps(0)
  }
  function openEditGoal(g) {
    const m = normMetric(g.metric)
    setEdIsNew(false)
    setEdExId(g.exerciseId)
    setEdMetric(m)
    setEdValue(m, g.targetWeight)
    setEdReps(Number(g.targetReps) > 0 ? Math.round(Number(g.targetReps)) : 0)
    setEditing(true)
  }

  async function saveGoal() {
    if (!edExId) return
    const ex = records.find((r) => r.exId === edExId)
    const metric = normMetric(edMetric)
    // целевое значение в единицах метрики: вес — десятые, повторы/время — целое.
    const target =
      metric === 'weight' ? Math.round((Number(edVal) || 0) * 10) / 10 : Math.max(0, Math.round(Number(edVal) || 0))
    // Защита от «сохранил с непрожатым полем»: на мобильной клавиатуре тап по
    // «Сохранить» без blur оставляет edVal пустой строкой → Number('')→0 молча
    // записал бы бессмысленную цель в 0. Цель ≤ 0 не сохраняем (оставляем диалог).
    if (!(target > 0)) return
    // Повторы при целевом весе — только у весовой цели; 0/'' → нет требования (null).
    const reps = metric === 'weight' && Number(edReps) > 0 ? Math.round(Number(edReps)) : null
    const list = await readGoals(user.id) // свежий массив (вкл. tombstone'ы)
    const idx = list.findIndex((g) => g.exerciseId === edExId)
    let next
    if (idx >= 0) {
      const prevW = Number(list[idx].targetWeight)
      const prevR = Number(list[idx].targetReps) || 0
      // смена веса ИЛИ повторов → цель можно достичь заново; иначе не сбрасываем.
      const changed = prevW !== target || prevR !== (reps || 0)
      next = list.map((g, i) =>
        i === idx
          ? {
              ...g,
              exerciseName: ex?.name ?? g.exerciseName ?? '—',
              metric,
              targetWeight: target,
              targetReps: reps,
              _dirty: 1,
              _deleted: 0,
              achievedAt: changed ? null : g.achievedAt ?? null,
            }
          : g
      )
    } else {
      next = [
        ...list,
        { exerciseId: edExId, exerciseName: ex?.name ?? '—', metric, targetWeight: target, targetReps: reps, achievedAt: null, _dirty: 1 },
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
          {/* быстрые цифры — «за всё время». Скользящие метрики (за месяц,
              серия) живут на Главной, здесь не дублируем (акценты разведены). */}
          <div className="stat-grid">
            <div className="stat-cell">
              <div className="stat-num">{summary.totalWorkouts}</div>
              <div className="stat-lab">тренировок<br />всего</div>
            </div>
            <div className="stat-cell">
              {(() => {
                const t = fmtTonnage(summary.tonnage)
                return (
                  <div className="stat-num">{t.value}<span className="u"> {t.unit}</span></div>
                )
              })()}
              <div className="stat-lab">поднято<br />всего</div>
            </div>
          </div>

          {/* личные цели (мульти-цели) */}
          <section className="sec">
            <p className="sec-title">Мои цели</p>
            {editing ? (
              <div className="goal">
                <div className="goal-editor" ref={editorRef}>
                  {edIsNew ? (
                    <label className="field">
                      <span className="field-lab">Упражнение</span>
                      <select
                        className="prog-select"
                        value={String(edExId ?? '')}
                        onChange={(e) => chooseGoalExercise(e.target.value)}
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
                    <span className="field-lab">
                      {edMetric === 'time' ? 'Цель (время)' : edMetric === 'reps' ? 'Цель (повторы)' : 'Целевой вес'}
                    </span>
                    {edMetric === 'weight' ? (
                      <div className="goal-stepper">
                        <HoldButton
                          onTrigger={() => setEdVal((w) => Math.max(1.5, Math.round((Number(w) - 1.5) * 10) / 10))}
                        >−</HoldButton>
                        <span className="val">
                          <input
                            className="val-field"
                            type="text"
                            inputMode="decimal"
                            value={edVal}
                            onChange={(e) =>
                              setEdVal(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))
                            }
                            onBlur={() =>
                              setEdVal((w) => {
                                const n = Number(w)
                                return n > 0 ? Math.round(n * 10) / 10 : 2.5
                              })
                            }
                            aria-label="Целевой вес в килограммах"
                          />
                          <span className="u">кг</span>
                        </span>
                        <HoldButton
                          onTrigger={() => setEdVal((w) => Math.round((Number(w) + 1.5) * 10) / 10)}
                        >+</HoldButton>
                      </div>
                    ) : edMetric === 'reps' ? (
                      <div className="goal-stepper">
                        <HoldButton
                          onTrigger={() => setEdVal((v) => Math.max(1, Math.round(Number(v) || 0) - 1))}
                        >−</HoldButton>
                        <span className="val">
                          <input
                            className="val-field"
                            type="text"
                            inputMode="numeric"
                            value={edVal}
                            onChange={(e) => setEdVal(e.target.value.replace(/[^\d]/g, ''))}
                            onBlur={() => setEdVal((v) => Math.max(1, Math.round(Number(v) || 0)))}
                            aria-label="Целевое число повторов"
                          />
                          <span className="u">повт.</span>
                        </span>
                        <HoldButton
                          onTrigger={() => setEdVal((v) => Math.round(Number(v) || 0) + 1)}
                        >+</HoldButton>
                      </div>
                    ) : (
                      <div className="goal-stepper">
                        <HoldButton
                          onTrigger={() => setEdVal((v) => { const n = Math.max(5, Math.round(Number(v) || 0) - 5); setEdTimeStr(fmtTime(n)); return n })}
                        >−</HoldButton>
                        <span className="val">
                          <input
                            className="val-field"
                            type="text"
                            inputMode="numeric"
                            value={edTimeStr}
                            onChange={(e) => { setEdTimeStr(e.target.value); setEdVal(parseTime(e.target.value)) }}
                            onBlur={() => { const n = parseTime(edTimeStr); setEdVal(n); setEdTimeStr(fmtTime(n)) }}
                            aria-label="Целевое время в формате минуты:секунды"
                          />
                          <span className="u">мин:сек</span>
                        </span>
                        <HoldButton
                          onTrigger={() => setEdVal((v) => { const n = Math.round(Number(v) || 0) + 5; setEdTimeStr(fmtTime(n)); return n })}
                        >+</HoldButton>
                      </div>
                    )}
                  </label>
                  {edMetric === 'weight' && (
                    <label className="field">
                      <span className="field-lab">Повторы при этом весе <span className="muted">(необязательно)</span></span>
                      <div className="goal-stepper">
                        <HoldButton
                          onTrigger={() => setEdReps((v) => Math.max(0, Math.round(Number(v) || 0) - 1))}
                        >−</HoldButton>
                        <span className="val">
                          <input
                            className="val-field"
                            type="text"
                            inputMode="numeric"
                            value={edReps ? String(edReps) : ''}
                            placeholder="—"
                            onChange={(e) => setEdReps(e.target.value.replace(/[^\d]/g, ''))}
                            onBlur={() => setEdReps((v) => Math.max(0, Math.round(Number(v) || 0)))}
                            aria-label="Повторы при целевом весе (необязательно)"
                          />
                          <span className="u">повт.</span>
                        </span>
                        <HoldButton
                          onTrigger={() => setEdReps((v) => Math.round(Number(v) || 0) + 1)}
                        >+</HoldButton>
                      </div>
                    </label>
                  )}
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
                  const m = normMetric(g.metric)
                  const cur = currentBestValue(workouts ?? [], g.exerciseId, m)
                  const pct = goalProgress(cur, g.targetWeight)
                  const left = Math.max(0, g.targetWeight - cur)
                  // Повторы при целевом весе (PLAN-goal-reps) — только у весовой цели.
                  const reps = m === 'weight' && Number(g.targetReps) > 0 ? Math.round(Number(g.targetReps)) : 0
                  return (
                    <div className="goal" key={g.exerciseId}>
                      <div className="goal-top">
                        <span className="lbl">
                          {g.exerciseName} <b>{fmtMetricValue(m, g.targetWeight)}{reps ? ` × ${reps}` : ''}</b>
                        </span>
                        <span className="pct">{pct}%</span>
                      </div>
                      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                      {g.achievedAt ? (
                        <div className="goal-sub achieved">🎯 Цель достигнута!</div>
                      ) : (
                        <div className="goal-sub">
                          текущий рекорд {fmtMetricValue(m, cur)} · осталось {fmtMetricValue(m, left)}
                          {reps ? <> · нужно ≥{reps} повт. в подходе</> : null}
                        </div>
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
                  <div className="v">{place.n}-е место {place.board === 'f' ? 'по ягодичному мостику' : 'по жиму'}</div>
                  <div className="k">лидерборд живёт в Ленте</div>
                </div>
                <span className="go">Лента ›</span>
              </button>
            </section>
          )}
        </>
      )}

      {/* доступ к тренировкам (связи «избранного круга», v3.14.0) */}
      <ConnectionsSection user={user} />

      {/* настройки и выход — свёрнуто по умолчанию, чтобы длинный экран не пух */}
      <section className="sec settings-sec">
        <button
          className="settings-toggle"
          onClick={() => setSettingsOpen((o) => !o)}
          aria-expanded={settingsOpen}
        >
          <span className="settings-title"><span aria-hidden="true">⚙️</span> Настройки</span>
          <span className="settings-chev" aria-hidden="true">{settingsOpen ? '▾' : '▸'}</span>
        </button>

        {/* Проблема с отправкой — важный алерт: виден всегда, даже когда свёрнуто. */}
        {deadCount > 0 && (
          <div className="danger-confirm">
            <p className="danger-text">
              ⚠️ Не удалось отправить изменений: {deadCount}. Обычно помогает повторить
              (например, после восстановления связи).
            </p>
            {dlArm ? (
              <div className="danger-actions">
                <button className="btn ghost" onClick={() => setDlArm(false)} disabled={dlBusy}>Отмена</button>
                <button className="btn danger" onClick={discardDead} disabled={dlBusy}>
                  {dlBusy ? 'Отклоняю…' : 'Да, отклонить (потерять правки)'}
                </button>
              </div>
            ) : (
              <div className="danger-actions">
                <button className="btn primary" onClick={retryDead} disabled={dlBusy}>
                  {dlBusy ? 'Отправляю…' : '🔄 Повторить отправку'}
                </button>
                <button className="btn ghost" onClick={() => setDlArm(true)} disabled={dlBusy}>Отклонить</button>
              </div>
            )}
          </div>
        )}

        {settingsOpen && (
        <div className="actions">
          <button
            className="act toggle-act"
            role="switch"
            aria-checked={progEnabled}
            onClick={() => setProgEnabled(user.id, !progEnabled)}
          >
            <span className="toggle-act-txt">
              📈 Рекомендации прогрессии
              <span className="toggle-act-sub">подсказка веса/повторов при добавлении упражнения</span>
            </span>
            <span className={'toggle-pill' + (progEnabled ? ' on' : '')} aria-hidden="true">
              <span className="toggle-knob" />
            </span>
          </button>
          {pinOpen ? (
            <div className="pin-form">
              <p className="pin-form-title">Смена PIN</p>
              <label className="field">
                <span className="field-lab">Текущий PIN</span>
                <input
                  className="pin-input" type="password" inputMode="numeric"
                  autoComplete="off" name="cur-code" data-lpignore="true" data-1p-ignore
                  placeholder="••••"
                  value={curPin} onChange={(e) => setCurPin(onlyDigits(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-lab">Новый PIN</span>
                <input
                  className="pin-input" type="password" inputMode="numeric"
                  autoComplete="off" name="new-code" data-lpignore="true" data-1p-ignore
                  placeholder="4 цифры"
                  value={newPin} onChange={(e) => setNewPin(onlyDigits(e.target.value))}
                />
              </label>
              <label className="field">
                <span className="field-lab">Повтор нового PIN</span>
                <input
                  className="pin-input" type="password" inputMode="numeric"
                  autoComplete="off" name="rpt-code" data-lpignore="true" data-1p-ignore
                  placeholder="ещё раз"
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
        </div>
        )}

        {/* Выход — частое действие, держим на виду всегда (вне сворачивания). */}
        <div className="actions">
          <button className="act logout" onClick={onLogout}>Выйти</button>
        </div>
      </section>

      {/* версия приложения — подставляется на сборке из package.json (vite define) */}
      <p className="app-version">kachalka-app · v{APP_VERSION}</p>
    </div>
  )
}

// ── Доступ к тренировкам (связи «избранного круга», v3.14.0) ─────────────────
// Взаимная связь с подтверждением: открываешь свои тренировки конкретному человеку
// и одновременно видишь его. Особенно нужно приватным (они закрыты от всех, но
// могут собрать личный круг). Публичным — способ увидеть тренировки приватного
// друга. Данные — из локального кэша connections (снимок my_connections на pull),
// правки офлайн-first через repo (request/accept/removeConnection).
function ConnectionsSection({ user }) {
  const rows = useLiveQuery(() => getConnections(), [], [])
  const roster = useLiveQuery(() => getUsers(), [], [])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)

  const { accepted, incoming, outgoing } = useMemo(
    () => deriveConnections(rows ?? [], user.id),
    [rows, user.id]
  )

  // Имя участника: свежее из ростера, фолбэк — сохранённое в связи.
  const nameById = useMemo(() => {
    const m = new Map()
    for (const u of roster ?? []) m.set(u.id, u.name)
    return m
  }, [roster])
  const dispName = (row) => nameById.get(row.other_id) ?? row.other_name ?? '—'

  // Кандидаты «добавить»: ростер минус я минус уже-в-связях (любой статус).
  const candidates = useMemo(() => {
    const taken = new Set((rows ?? []).map((r) => r.other_id))
    return (roster ?? []).filter((u) => u.id !== user.id && !taken.has(u.id))
  }, [roster, rows, user.id])

  async function run(fn, ok) {
    setBusy(true)
    try {
      await fn()
      if (navigator.onLine) syncNow(user.id)
      if (ok) showToast(ok)
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: String(e?.message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  function onAdd() {
    if (!pick) return
    const id = pick
    const name = nameById.get(id) ?? '—'
    setPick('')
    run(() => requestConnection(user.id, id, name), { emoji: '🤝', title: 'Запрос отправлен', sub: name })
  }

  return (
    <section className="sec">
      <p className="sec-title">Доступ к тренировкам</p>
      <p className="hint">
        Взаимный доступ по подтверждению: вы с другом видите тренировки друг друга.
        Так приватный может открыться избранным, не открываясь всем.
      </p>

      {/* входящие запросы */}
      {incoming.map((r) => (
        <div className="goal" key={`in-${r.other_id}`}>
          <div className="goal-top">
            <span className="lbl">{dispName(r)}</span>
          </div>
          <div className="goal-sub">хочет открыть тебе доступ к своим тренировкам</div>
          <div className="goal-editor-actions">
            <button className="btn danger-ghost" disabled={busy}
              onClick={() => run(() => removeConnection(r.other_id))}>Отклонить</button>
            <button className="btn primary" disabled={busy}
              onClick={() => run(() => acceptConnection(r.other_id), { emoji: '🤝', title: 'Доступ открыт', sub: dispName(r) })}>Принять</button>
          </div>
        </div>
      ))}

      {/* принятые связи (мой круг) */}
      {accepted.map((r) => (
        <div className="goal" key={`ok-${r.other_id}`}>
          <div className="goal-top">
            <span className="lbl">{dispName(r)}</span>
            <span className="pct">🤝</span>
          </div>
          <div className="goal-sub achieved">взаимный доступ открыт</div>
          <div className="goal-editor-actions">
            <button className="btn danger-ghost" disabled={busy}
              onClick={() => run(() => removeConnection(r.other_id))}>Убрать доступ</button>
          </div>
        </div>
      ))}

      {/* исходящие (ждут подтверждения) */}
      {outgoing.map((r) => (
        <div className="goal" key={`out-${r.other_id}`}>
          <div className="goal-top">
            <span className="lbl">{dispName(r)}</span>
          </div>
          <div className="goal-sub">запрос отправлен, ждём подтверждения</div>
          <div className="goal-editor-actions">
            <button className="btn ghost" disabled={busy}
              onClick={() => run(() => removeConnection(r.other_id))}>Отменить</button>
          </div>
        </div>
      ))}

      {/* добавить нового */}
      {candidates.length > 0 ? (
        <div className="goal">
          <label className="field">
            <span className="field-lab">Открыть доступ участнику</span>
            <select className="prog-select" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">— выбери участника —</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <div className="goal-editor-actions">
            <button className="btn primary" onClick={onAdd} disabled={busy || !pick}>Отправить запрос</button>
          </div>
        </div>
      ) : (
        accepted.length === 0 && incoming.length === 0 && outgoing.length === 0 && (
          <p className="muted empty">Пока не с кем обмениваться доступом.</p>
        )
      )}
    </section>
  )
}

// Версия из package.json, прокинутая через vite define. Fallback на случай
// запуска без define (напр. тесты) — чтобы не падать на ReferenceError.
const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
