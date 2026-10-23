// Секция Админки «Справочник упражнений» (вынесена из screens/AdminScreen.jsx, v6.14.1).
// С 23.10.2026 список и форма — общие с каталогом участника (components/exercises/ExerciseCatalog.jsx,
// ExerciseEditForm.jsx): те же разделы, поиск и выбор группы из списка, но править можно все, скрытые
// из пикера видны с пометкой, сохранение — онлайн admin_update_exercise. Здесь же — слияние дублей.
import { useEffect, useMemo, useRef, useState } from 'react'
import { findExactDuplicate } from '../../lib/similar.js'
import { isMergedAlias, mergeSources, mergeTargets, mergedSummary } from '../../lib/exerciseMerge.js'
import { adminUpdateExercise, adminMergeExercise } from '../../lib/admin.js'
import { catalogGroups } from '../../lib/exerciseCatalog.js'
import { normMetric } from '../../lib/metric.js'
import { showToast } from '../ui/Toast.jsx'
import ExerciseCatalog from '../exercises/ExerciseCatalog.jsx'
import ExerciseEditForm from '../exercises/ExerciseEditForm.jsx'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'

export default function ExercisesSection({ exercises, userId, online, errMsg }) {
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  // Слияние дублей
  const [mergeOpen, setMergeOpen] = useState(false)
  // Открытые формы — в видимую область (v8.0.1).
  const edRevealRef = useRevealFocus(editing?.id ?? null, { block: 'start' })
  const mergeRevealRef = useRevealFocus(mergeOpen ? 'merge' : null)
  const [mFrom, setMFrom] = useState('')
  const [mInto, setMInto] = useState('')
  const [mBusy, setMBusy] = useState(false)

  // Guard от setState после размонтирования (аккордеон-секцию можно свернуть, пока
  // RPC в полете) — как в UsersSection/AccessSection.
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // Слитые дубли (merged_into, v8.2.0) — не упражнения, а постоянные алиасы:
  // в списке их нет (иначе их можно было «показать» и получить живой дубль), только
  // сводкой под списком.
  const live = useMemo(() => exercises.filter((e) => !isMergedAlias(e)), [exercises])
  const merged = useMemo(() => mergedSummary(exercises), [exercises])
  const mergedCount = merged.reduce((n, m) => n + m.count, 0)
  const groups = useMemo(() => catalogGroups(live), [live])

  async function save(f) {
    if (!online) { showToast({ emoji: '📡', title: 'Нужна сеть' }); return }
    const ex = editing
    setBusy(true)
    try {
      // Тип отправляем, только если его поменяли: так обычная правка работает и до
      // накатки admin-exercise-metric.sql (старая функция не знает p_metric).
      await adminUpdateExercise({
        id: ex.id, name: f.name, muscle_group: f.muscle_group, submuscle: f.submuscle, secondary: f.secondary,
        is_bench_lift: Boolean(ex.is_bench_lift), is_female_lift: Boolean(ex.is_female_lift), is_hidden: f.is_hidden,
        metric: f.metric !== normMetric(ex.metric) ? f.metric : undefined,
      })
      showToast({ emoji: '✅', title: 'Упражнение обновлено' })
      if (alive.current) setEditing(null)
    } catch (e) {
      showToast({ emoji: '⚠️', title: 'Не удалось', sub: errMsg(e) })
    } finally {
      if (alive.current) setBusy(false)
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
        // Сохраняем текущую разметку мышц — иначе быстрый тумблер скрытия ее бы стер.
        submuscle: ex.submuscle ?? '',
        secondary: Array.isArray(ex.secondary) ? ex.secondary : [],
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
    const dup = findExactDuplicate(from.name, mergeTargets(exercises, mFrom))
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

  if (editing) {
    return (
      <section className="sec" ref={edRevealRef}>
        <p className="sec-title catalog-title">Упражнение</p>
        <ExerciseEditForm ex={editing} groups={groups} admin busy={busy} saveDisabled={!online}
          onCancel={() => setEditing(null)} onSubmit={save} />
      </section>
    )
  }

  return (
    <section className="sec">
      <ExerciseCatalog list={live} userId={userId} admin online={online} onEdit={setEditing} onToggleHidden={toggleHidden} />

      {mergedCount > 0 && (
        <details className="admin-merged">
          <summary className="admin-hint">Слито дублей: {mergedCount}</summary>
          <ul className="admin-merged-list">
            {merged.map((m) => (
              <li key={m.id} className="admin-hint">{m.name}{m.count > 1 ? ` ← ${m.count}` : ''}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Слияние дублей */}
      {mergeOpen ? (
        <div ref={mergeRevealRef} className="admin-merge">
          <p className="admin-merge-title">Слить дубль</p>
          <label className="field">
            <span className="field-lab">Что слить (скроется)</span>
            <select className="prog-select" value={mFrom} onChange={(e) => { setMFrom(e.target.value); setMInto('') }}>
              <option value="">— выбери —</option>
              {mergeSources(exercises).map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.is_hidden ? ' (скрыто)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-lab">Во что слить (останется)</span>
            <select className="prog-select" value={mInto} onChange={(e) => setMInto(e.target.value)}>
              <option value="">— выбери —</option>
              {mergeTargets(exercises, mFrom).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{mergeDupHint === e.id ? ' · похоже на дубль' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="admin-hint">
            Тренировки, шаблоны, цели и дисциплины рейтинга со старого упражнения переедут на новое,
            старое скроется насовсем. Общее упражнение можно слить только в общее.
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
