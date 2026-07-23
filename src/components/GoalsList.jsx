import { normMetric, fmtMetricValue } from '../lib/metric.js'
import { currentBestValue, goalProgress } from '../lib/profileStats.js'

// Read-only список личных целей с прогресс-баром (сам редактор цели остаётся в
// ProfileScreen). Презентационный: goalList + workouts (для текущего рекорда) +
// onEdit(goal)/onAdd. Прогресс/достижение/повторы-при-весе считаются из
// денормализованных тренировок. Повторы (PLAN-goal-reps) — только у весовой цели.
export default function GoalsList({ goalList, workouts, onEdit, onAdd }) {
  return (
    <div className="goals-list">
      {goalList.map((g) => {
        const m = normMetric(g.metric)
        const cur = currentBestValue(workouts ?? [], g.exerciseId, m)
        const pct = goalProgress(cur, g.targetWeight)
        const left = Math.max(0, g.targetWeight - cur)
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
            <button className="goal-edit" onClick={() => onEdit(g)}>✎ Изменить цель</button>
          </div>
        )
      })}
      <button className="goal-add" onClick={onAdd}>+ Добавить цель</button>
    </div>
  )
}
