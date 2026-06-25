import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getWorkouts } from '../db/repo.js'
import { getMeta, setMeta } from '../db/local.js'
import { goalKey } from '../db/notifications.js'
import { syncNow } from '../db/sync.js'
import { getCachedLeaderboard } from '../db/leaderboard.js'
import { summarize, currentBest, goalProgress } from '../lib/profileStats.js'

// Экран «Профиль» (ЛК). Всё про самого пользователя; пер-упражненческую
// аналитику не дублируем — рекорды уводят в «Прогресс». Считаем на клиенте из
// уже имеющихся денормализованных тренировок. Цель (фаза 2b) дополнительно
// уходит на сервер при сохранении, чтобы достижение увидел Telegram-бот.
//
// Пропсы: user, onLogout, onOpenProgress(exerciseId), onOpenFeed().
export default function ProfileScreen({ user, onLogout, onOpenProgress, onOpenFeed }) {
  const workouts = useLiveQuery(() => getWorkouts(user.id), [user.id])
  const goal = useLiveQuery(() => getMeta(goalKey(user.id)), [user.id])
  const loading = workouts === undefined

  const summary = useMemo(() => summarize(workouts ?? []), [workouts])
  const records = summary.personalRecords

  // Место в лидерборде по жиму (кэш Ленты/снимок). Только чтение, без запросов.
  const [place, setPlace] = useState(null)
  useEffect(() => {
    let alive = true
    getCachedLeaderboard()
      .then((board) => {
        if (!alive) return
        const idx = board.findIndex((r) => r.user_id === user.id)
        setPlace(idx >= 0 ? idx + 1 : null)
      })
      .catch(() => { if (alive) setPlace(null) })
    return () => { alive = false }
  }, [user.id, workouts])

  // ── Редактор цели ─────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [edExId, setEdExId] = useState(null)
  const [edWeight, setEdWeight] = useState(100)

  const goalEx = goal?.exerciseId
    ? records.find((r) => r.exId === goal.exerciseId)
    : null
  const goalCurrent = goal?.exerciseId ? currentBest(workouts ?? [], goal.exerciseId) : 0
  const goalPct = goal ? goalProgress(goalCurrent, goal.targetWeight) : 0
  const goalLeft = goal ? Math.max(0, Math.round((goal.targetWeight - goalCurrent) * 10) / 10) : 0

  function openEditor() {
    const base = goal?.exerciseId
      ? records.find((r) => r.exId === goal.exerciseId)
      : records.find((r) => r.isBench) || records[0]
    const exId = goal?.exerciseId ?? base?.exId ?? null
    const start = goal?.targetWeight ?? (base ? Math.max(base.weight + 5, 20) : 100)
    setEdExId(exId)
    setEdWeight(start)
    setEditing(true)
  }

  async function saveGoal() {
    if (!edExId) return
    const ex = records.find((r) => r.exId === edExId)
    await setMeta(goalKey(user.id), {
      exerciseId: edExId,
      exerciseName: ex?.name ?? '—',
      targetWeight: Number(edWeight) || 0,
      achievedAt: null, // новая/изменённая цель — можно достичь заново
      _dirty: 1, // отправить на сервер (для Telegram-бота), фаза 2b
    })
    setEditing(false)
    // Сразу пушим цель на сервер (если онлайн), чтобы бот увидел её до
    // ближайшей тренировки. Офлайн — уедет следующим фоновым синком.
    if (navigator.onLine) syncNow(user.id)
  }

  const avatar = (user.name ?? '?').trim().charAt(0).toUpperCase() || '?'

  return (
    <div className="screen profile">
      {/* шапка профиля */}
      <div className="prof-head">
        <div className="avatar-lg" aria-hidden="true">{avatar}</div>
        <div>
          <div className="prof-name">{user.name}</div>
          {user.role === 'admin' && <span className="role-badge">админ</span>}
        </div>
      </div>

      {loading && <p className="muted">Загрузка…</p>}

      {!loading && summary.totalWorkouts === 0 && (
        <p className="muted empty">
          Здесь будет твоя сводка: рекорды, стрик и цель. Запиши первую тренировку 💪
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
              <div className="stat-num">
                {summary.weeklyStreak}<span className="u"> нед</span>
              </div>
              <div className="stat-lab">подряд<br />в зале</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{summary.workoutsThisMonth}</div>
              <div className="stat-lab">за этот<br />месяц</div>
            </div>
          </div>

          {/* личная цель */}
          <section className="sec">
            <p className="sec-title">Моя цель</p>
            <div className="goal">
              {editing ? (
                <div className="goal-editor">
                  <label className="field">
                    <span className="field-lab">Упражнение</span>
                    <select
                      className="prog-select"
                      value={String(edExId ?? '')}
                      onChange={(e) => setEdExId(e.target.value)}
                    >
                      {records.map((r) => (
                        <option key={r.exId} value={String(r.exId)}>
                          {r.name}{r.isBench ? ' ⭐' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-lab">Целевой вес</span>
                    <div className="goal-stepper">
                      <button
                        type="button"
                        onClick={() => setEdWeight((w) => Math.max(2.5, Math.round((Number(w) - 2.5) * 10) / 10))}
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
                        onClick={() => setEdWeight((w) => Math.round((Number(w) + 2.5) * 10) / 10)}
                      >+</button>
                    </div>
                  </label>
                  <div className="goal-editor-actions">
                    <button className="btn ghost" onClick={() => setEditing(false)}>Отмена</button>
                    <button className="btn primary" onClick={saveGoal} disabled={!edExId}>Сохранить</button>
                  </div>
                </div>
              ) : goal ? (
                <>
                  <div className="goal-top">
                    <span className="lbl">
                      {goalEx?.name ?? goal.exerciseName} <b>{goal.targetWeight} кг</b>
                    </span>
                    <span className="pct">{goalPct}%</span>
                  </div>
                  <div className="bar"><i style={{ width: `${goalPct}%` }} /></div>
                  {goal.achievedAt ? (
                    <div className="goal-sub achieved">🎯 Цель достигнута! Поставь новую.</div>
                  ) : (
                    <div className="goal-sub">
                      текущий рекорд {goalCurrent} кг · осталось {goalLeft} кг
                    </div>
                  )}
                  <button className="goal-edit" onClick={openEditor}>
                    {goal.achievedAt ? '🎯 Поставить новую цель' : '✎ Изменить цель'}
                  </button>
                </>
              ) : (
                <button className="goal-edit set" onClick={openEditor}>
                  + Поставить цель
                </button>
              )}
            </div>
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
                        {r.weight} <span className="u">кг</span> <span className="arr">›</span>
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
          <button className="act soon" disabled>🔑 Сменить PIN <span className="tag">фаза 2c</span></button>
          <button className="act soon" disabled>⬇️ Экспорт моих данных <span className="tag">фаза 2c</span></button>
          <button className="act logout" onClick={onLogout}>Выйти</button>
        </div>
      </section>
    </div>
  )
}
