import { useState } from 'react'
import { submusclesOf, secondaryOptionsFor, labelOf, majorOf, defaultSubmuscleFor } from '../../lib/muscles.js'
import { normMetric } from '../../lib/metric.js'
import { METRIC_OPTIONS } from '../../lib/exerciseCatalog.js'

// Форма упражнения — одна для каталога участника и Админки (23.10.2026). Группа — только из
// списка (groups): свободный текст в Админке плодил группы-опечатки без зоны на карте мышц. Смена
// типа предупреждает, что записанные подходы прочитаются по-новому, — и участника тоже.
// admin — еще «Скрыть из пикера» и подсказка про рейтинг. Сохраняет экран: onSubmit(поля), где
// поля — { name, muscle_group, submuscle, secondary, metric, is_hidden }; error/busy — от него же.
// Пропсы: ex, groups, admin, busy, error, saveDisabled (Админка офлайн), onCancel, onSubmit.
export default function ExerciseEditForm({
  ex, groups, admin = false, busy = false, error = null, saveDisabled = false, onCancel, onSubmit,
}) {
  const metricInit = normMetric(ex.metric)
  const [name, setName] = useState(ex.name ?? '')
  const [group, setGroup] = useState(ex.muscle_group ?? '')
  const [sub, setSub] = useState(ex.submuscle ?? defaultSubmuscleFor(ex.muscle_group) ?? '')
  const [secondary, setSecondary] = useState(Array.isArray(ex.secondary) ? ex.secondary : [])
  const [metric, setMetric] = useState(metricInit)
  const [hidden, setHidden] = useState(Boolean(ex.is_hidden))
  const [problem, setProblem] = useState(null)
  const options = groups.includes(group) || !group ? groups : [...groups, group]

  // Смена группы: подмышку сбрасываем на дефолт группы, вторичные чистим (варианты зависят от основной).
  function pickGroup(g) {
    setGroup(g)
    setSub(defaultSubmuscleFor(g) ?? '')
    setSecondary([])
  }

  function submit() {
    const clean = name.trim()
    if (!clean) { setProblem('Введи название упражнения.'); return }
    if (!group) { setProblem('Выбери группу мышц.'); return }
    setProblem(null)
    onSubmit({ name: clean, muscle_group: group, submuscle: sub, secondary, metric, is_hidden: hidden })
  }

  const shown = problem ?? error
  return (
    <>
      <input
        className="search"
        placeholder="Название упражнения"
        aria-label="Название упражнения"
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />

      <div className="create-label">Тип</div>
      <div className="chips wrap">
        {METRIC_OPTIONS.map((m) => (
          <button key={m.id} type="button" className={metric === m.id ? 'chip active' : 'chip'}
            aria-pressed={metric === m.id} onClick={() => setMetric(m.id)}>{m.label}</button>
        ))}
      </div>
      {metric !== metricInit && (
        <p className="muted catalog-hint">
          Уже записанные подходы не пересчитываются: число в них прочитается по-новому
          (например, 60 повторений станут 1:00).
        </p>
      )}

      <div className="create-label">Группа мышц</div>
      <div className="chips wrap">
        {options.map((g) => (
          <button key={g} type="button" className={g === group ? 'chip active' : 'chip'}
            aria-pressed={g === group} onClick={() => pickGroup(g)}>{g}</button>
        ))}
      </div>

      {submusclesOf(group).length > 0 && (
        <>
          <div className="create-label">Основная мышца</div>
          <div className="chips wrap">
            {submusclesOf(group).map((s) => (
              <button
                key={s} type="button" className={s === sub ? 'chip active' : 'chip'} aria-pressed={s === sub}
                onClick={() => { setSub(s); setSecondary((sec) => sec.filter((x) => x !== s)) }}
              >
                {labelOf(s)}
              </button>
            ))}
          </div>
        </>
      )}

      {sub && (
        <>
          <div className="create-label">Вторичные мышцы <span className="muted">(необязательно)</span></div>
          <div className="chips wrap">
            {secondaryOptionsFor(sub).map((s) => {
              const on = secondary.includes(s)
              return (
                <button key={s} type="button" className={on ? 'chip active' : 'chip'} aria-pressed={on}
                  onClick={() => setSecondary((sec) => (on ? sec.filter((x) => x !== s) : [...sec, s]))}>
                  {labelOf(s)}<span className="chip-major"> · {majorOf(s)}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {admin && (
        <>
          <p className="muted catalog-hint">Участие в рейтинге настраивается в разделе «Дисциплины рейтинга».</p>
          <label className="admin-check">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            <span>Скрыть из пикера</span>
          </label>
        </>
      )}

      {shown && <p className="error create-error">{shown}</p>}

      <div className="btn-row catalog-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button type="button" className="btn primary" onClick={submit} disabled={busy || saveDisabled}>
          {busy ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </>
  )
}
