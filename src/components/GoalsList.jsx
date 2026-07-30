import { useState } from 'react'
import { normMetric, fmtMetricValue } from '../lib/metric.js'
import { currentBestValue, goalProgress } from '../lib/profileStats.js'
import { useRevealFocus } from '../hooks/useRevealFocus.js'

// Read-only список личных целей с прогресс-баром (сам редактор цели остаётся в
// ProfileScreen). Презентационный: goalList + workouts (для текущего рекорда) +
// onEdit(goal)/onAdd. Прогресс/достижение/повторы-при-весе считаются из
// денормализованных тренировок. Повторы (PLAN-goal-reps) — только у весовой цели.
// По умолчанию видны три ближайшие АКТИВНЫЕ цели. Достигнутые не вытесняют их:
// они идут отдельной группой после активных и раскрываются вместе с хвостом.
const PREVIEW_LIMIT = 3

export default function GoalsList({ goalList, workouts, onEdit, onAdd }) {
  const [expanded, setExpanded] = useState(false)
  const revealRef = useRevealFocus(expanded ? 'goals-expanded' : null)
  const preparedGoals = goalList
    .map((goal, index) => {
      const metric = normMetric(goal.metric)
      const current = currentBestValue(workouts ?? [], goal.exerciseId, metric)
      return {
        goal,
        metric,
        current,
        progress: goalProgress(current, goal.targetWeight),
        index,
      }
    })
  const activeGoals = preparedGoals
    .filter(({ goal }) => !goal.achievedAt)
    .sort((a, b) => b.progress - a.progress || a.index - b.index)
  const achievedGoals = preparedGoals
    .filter(({ goal }) => Boolean(goal.achievedAt))
    .sort((a, b) => {
      const byDate = Date.parse(b.goal.achievedAt) - Date.parse(a.goal.achievedAt)
      return (Number.isFinite(byDate) ? byDate : 0) || a.index - b.index
    })
  const previewGoals = activeGoals.slice(0, PREVIEW_LIMIT)
  const previewAchieved = achievedGoals.slice(
    0,
    Math.max(0, PREVIEW_LIMIT - previewGoals.length)
  )
  const hiddenCount =
    activeGoals.length - previewGoals.length +
    achievedGoals.length - previewAchieved.length
  const hasMore = hiddenCount > 0
  const firstRevealedId = expanded
    ? (
        activeGoals[PREVIEW_LIMIT]?.goal.exerciseId ??
        achievedGoals[previewAchieved.length]?.goal.exerciseId
      )
    : null

  function renderGoal({ goal: g, metric: m, current: cur, progress: pct }) {
    const left = Math.max(0, g.targetWeight - cur)
    const reps = m === 'weight' && Number(g.targetReps) > 0 ? Math.round(Number(g.targetReps)) : 0
    const waitingForReps = !g.achievedAt && pct >= 100 && reps > 0
    return (
      <div
        className="goal"
        key={g.exerciseId}
        ref={String(g.exerciseId) === String(firstRevealedId) ? revealRef : undefined}
      >
        <div className="goal-top">
          <span className="lbl">
            {g.exerciseName} <b>{fmtMetricValue(m, g.targetWeight)}{reps ? ` × ${reps}` : ''}</b>
          </span>
          <span className="pct">{pct}%</span>
        </div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        {g.achievedAt ? (
          <div className="goal-sub achieved">🎯 Цель достигнута!</div>
        ) : waitingForReps ? (
          <div className="goal-sub">
            целевой вес взят · нужно ≥{reps} повт. в подходе
          </div>
        ) : (
          <div className="goal-sub">
            текущий рекорд {fmtMetricValue(m, cur)} · осталось {fmtMetricValue(m, left)}
            {reps ? <> · нужно ≥{reps} повт. в подходе</> : null}
          </div>
        )}
        <button className="goal-edit" onClick={() => onEdit(g)}>✎ Изменить цель</button>
      </div>
    )
  }

  return (
    <div className="goals-list">
      {(expanded ? activeGoals : previewGoals).map(renderGoal)}
      {(expanded ? achievedGoals : previewAchieved).length > 0 && (
        <>
          <p className="goals-group-title">Достигнутые</p>
          {(expanded ? achievedGoals : previewAchieved).map(renderGoal)}
        </>
      )}
      {hasMore && (
        <button
          className="goals-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>{expanded ? 'Свернуть' : `Показать остальные ${hiddenCount}`}</span>
          <span className="goals-toggle-arr" aria-hidden="true">
            {expanded ? '⌃' : '⌄'}
          </span>
        </button>
      )}
      <button className="goal-add" onClick={onAdd}>+ Добавить цель</button>
    </div>
  )
}
