// Секция Админки «Справочник упражнений» (вынесена из screens/AdminScreen.jsx, v6.14.1).
import { useEffect, useMemo, useRef, useState } from 'react'
import { findExactDuplicate } from '../../lib/similar.js'
import { adminUpdateExercise, adminMergeExercise } from '../../lib/admin.js'
import { submusclesOf, secondaryOptionsFor, labelOf, majorOf, defaultSubmuscleFor } from '../../lib/muscles.js'
import { normMetric } from '../../lib/metric.js'
import { showToast } from '../Toast.jsx'
import PencilIcon from '../PencilIcon.jsx'

// ─────────────────────────── Упражнения ───────────────────────────────────
// Тип упражнения (v6.3.6): у админа «Каталога» нет, поэтому меняем здесь.
const METRIC_OPTIONS = [
  { id: 'weight', label: 'Вес и повторения', meta: null },
  { id: 'reps', label: 'Только повторения', meta: 'повторения' },
  { id: 'time', label: 'На время', meta: 'на время' },
  { id: 'distance', label: 'Дистанция и время', meta: 'дистанция' },
]
export default function ExercisesSection({ exercises, online, errMsg }) {
  const [query, setQuery] = useState('')
  const [edId, setEdId] = useState(null)
  const [form, setForm] = useState({ name: '', muscle_group: '', submuscle: '', secondary: [], is_bench_lift: false, is_female_lift: false, is_hidden: false, metric: 'weight' })
  // Тип на момент открытия формы: p_metric шлем только при реальной смене (см. save).
  const [metricInit, setMetricInit] = useState('weight')
  const [busy, setBusy] = useState(false)

  // Слияние дублей
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mFrom, setMFrom] = useState('')
  const [mInto, setMInto] = useState('')
  const [mBusy, setMBusy] = useState(false)

  // Guard от setState после размонтирования (аккордеон-секцию можно свернуть, пока
  // RPC в полете) — как в UsersSection/AccessSection.
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

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
      submuscle: ex.submuscle ?? defaultSubmuscleFor(ex.muscle_group) ?? '',
      secondary: Array.isArray(ex.secondary) ? ex.secondary : [],
      is_bench_lift: Boolean(ex.is_bench_lift),
      is_female_lift: Boolean(ex.is_female_lift),
      is_hidden: Boolean(ex.is_hidden),
      metric: normMetric(ex.metric),
    })
    setMetricInit(normMetric(ex.metric))
  }
  function closeEdit() { setEdId(null); setBusy(false) }

  async function save() {
    if (!online) { showToast({ emoji: '📡', title: 'Нужна сеть' }); return }
    setBusy(true)
    try {
      // Тип отправляем, только если его поменяли: так обычная правка работает и до
      // накатки admin-exercise-metric.sql (старая функция не знает p_metric).
      await adminUpdateExercise({ id: edId, ...form, metric: form.metric !== metricInit ? form.metric : undefined })
      showToast({ emoji: '✅', title: 'Упражнение обновлено' })
      if (alive.current) closeEdit()
    } catch (e) {
      if (alive.current) setBusy(false)
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
                    value={form.muscle_group}
                    onChange={(e) => {
                      const g = e.target.value
                      // Смена группы → подмышку сбрасываем на дефолт новой группы,
                      // вторичные чистим (варианты зависят от primary).
                      setForm((f) => ({ ...f, muscle_group: g, submuscle: defaultSubmuscleFor(g.trim()) ?? '', secondary: [] }))
                    }}
                  />
                </label>

                {submusclesOf(form.muscle_group.trim()).length > 0 && (
                  <label className="field">
                    <span className="field-lab">Основная мышца</span>
                    <select
                      className="admin-input"
                      value={form.submuscle}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        submuscle: e.target.value,
                        // выбранная основная не может быть среди вторичных
                        secondary: (f.secondary ?? []).filter((s) => s !== e.target.value),
                      }))}
                    >
                      {submusclesOf(form.muscle_group.trim()).map((s) => (
                        <option key={s} value={s}>{labelOf(s)}</option>
                      ))}
                    </select>
                  </label>
                )}

                {form.submuscle && (
                  <div className="field">
                    <span className="field-lab">Вторичные мышцы</span>
                    <div className="chips wrap admin-sec-chips">
                      {secondaryOptionsFor(form.submuscle).map((s) => {
                        const on = (form.secondary ?? []).includes(s)
                        return (
                          <button
                            type="button"
                            key={s}
                            className={on ? 'chip active' : 'chip'}
                            onClick={() => setForm((f) => ({
                              ...f,
                              secondary: on
                                ? f.secondary.filter((x) => x !== s)
                                : [...(f.secondary ?? []), s],
                            }))}
                          >
                            {labelOf(s)}<span className="chip-major"> · {majorOf(s)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="field">
                  <span className="field-lab">Тип</span>
                  <div className="chips wrap" role="radiogroup" aria-label="Тип упражнения">
                    {METRIC_OPTIONS.map((m) => (
                      <button
                        type="button" key={m.id} role="radio" aria-checked={form.metric === m.id}
                        className={form.metric === m.id ? 'chip active' : 'chip'}
                        onClick={() => setForm((f) => ({ ...f, metric: m.id }))}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {form.metric !== metricInit && (
                    <p className="muted admin-hint">
                      Уже записанные подходы не пересчитываются: число в них прочитается по-новому
                      (например, 60 повторений станут 1:00).
                    </p>
                  )}
                </div>

                <p className="muted admin-hint">Участие в рейтинге настраивается в разделе «Дисциплины рейтинга».</p>
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
                    {ex.name}
                  </span>
                  <span className="admin-ex-meta">
                    {ex.muscle_group || '—'}
                    {ex.submuscle ? ' · ' + labelOf(ex.submuscle) : ''}
                    {Array.isArray(ex.secondary) && ex.secondary.length ? ` +${ex.secondary.length}` : ''}
                    {METRIC_OPTIONS.find((m) => m.id === normMetric(ex.metric))?.meta ? ` · ${METRIC_OPTIONS.find((m) => m.id === normMetric(ex.metric)).meta}` : ''}
                    {ex.is_custom ? ' · свое' : ''}
                    {ex.is_hidden ? ' · скрыто' : ''}
                  </span>
                </div>
                <div className="admin-ex-btns">
                  <button className="admin-mini" onClick={() => openEdit(ex)} aria-label="Изменить"><PencilIcon size={16} /></button>
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
