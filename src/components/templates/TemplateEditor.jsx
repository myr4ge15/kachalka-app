import { Fragment, useState, useEffect, useRef } from 'react'
import { useRevealFocus } from '../../hooks/useRevealFocus.js'
import { useSortable } from '../../hooks/useSortable.js'
import { PHASES, PHASE_MOVE_LABEL, phaseHeading, phaseOf, phaseValue, reorderWithPhase, setEntryPhase } from '../../lib/workoutPhases.js'
import MoreMenu from '../ui/MoreMenu.jsx'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises, getTemplate, saveTemplate, deleteTemplate, createExercise, getFavorites, toggleFavorite } from '../../db/repo.js'
import { syncNow } from '../../db/sync.js'
import { exerciseMetric, fmtTemplateTarget } from '../../lib/metric.js'
import ExercisePicker from '../exercises/ExercisePicker.jsx'
import CardsSkeleton from '../ui/CardsSkeleton.jsx'
import BackButton from '../ui/BackButton.jsx'
import ScrollTopButton from '../ui/ScrollTopButton.jsx'
import TemplateSets from './TemplateSets.jsx'
import { templatePlan } from '../../lib/templatePlan.js'
import { sk } from '../../lib/progressionCard.js'
import { showToast, hideToast } from '../ui/Toast.jsx'
import Icon from '../ui/Icon.jsx'

// Редактор шаблона: состав, построчные подходы (TemplateSets), перестановка, общий/личный,
// удаление (вынесено из screens/TemplatesScreen.jsx, аудит 14.10). Чужой общий — только чтение.

// Старые цели разворачиваем в строки только в форме, исходный документ не меняем.
function toItems(tpl) {
  return [...(tpl?.exercises ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((e) => {
    const exercise = { ...(e.exercise ?? { id: e.exercise_id, name: '—' }), ...(e.metric ? { metric: e.metric } : {}) }
    const item = { exercise, metric: exerciseMetric(exercise), set_plan: templatePlan(exercise, e).map((s) => ({ ...s, _k: sk() })) }
    return phaseValue(e.phase) ? { ...item, phase: phaseValue(e.phase) } : item // разминка/заминка
  })
}

// Снимок формы для «есть несохраненные правки»: без служебных ключей строк (_k).
function formSnapshot(name, items, isPublic) {
  return JSON.stringify([name.trim(), isPublic, items.map((it) => [it.exercise.id, it.metric, it.phase ?? null,
    (it.set_plan ?? []).map(({ _k, ...s }) => s)])])
}

// ----------------------------- редактор ------------------------------------
// backGuardRef (UI-ревью 23.10): «назад» и свайп назад (TemplatesScreen) сначала спрашивают
// редактор — при несохраненных правках он показывает «Выйти без сохранения?» и отвечает true
// (уход отменен). Сохранение и удаление уходят напрямую через onBack.
export default function TemplateEditor({ user, templateId, onBack, backGuardRef = null }) {
  const isNew = templateId == null
  const exercises = useLiveQuery(() => getExercises(), [], [])
  const favorites = useLiveQuery(() => getFavorites(user.id), [user.id], [])

  const [name, setName] = useState('')
  const [items, setItems] = useState([])
  const [phaseMenu, setPhaseMenu] = useState(null) // id упражнения с открытым меню блока
  const [isPublic, setIsPublic] = useState(false)
  // Чужой общий шаблон открывается в режиме просмотра (read-only): править
  // может только автор. Для нового и своих — false.
  const [readOnly, setReadOnly] = useState(false)
  const [authorName, setAuthorName] = useState(null)
  const [loading, setLoading] = useState(!isNew)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  useEffect(() => {
    if (!message?.transient) return
    const t = setTimeout(() => setMessage((m) => (m === message ? null : m)), 2500)
    return () => clearTimeout(t)
  }, [message])
  const [delArm, setDelArm] = useState(false) // in-app подтверждение удаления (единый паттерн)
  const [leaveAsk, setLeaveAsk] = useState(null) // { at } — «Выйти без сохранения?»
  const leaveRef = useRevealFocus(leaveAsk)
  // Исходное состояние формы: пустое для нового, загруженное — для существующего.
  const baseRef = useRef(formSnapshot('', [], false))
  const dirty = !readOnly && !loading && formSnapshot(name, items, isPublic) !== baseRef.current
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty && !saving
  useEffect(() => {
    if (!backGuardRef) return undefined
    backGuardRef.current = () => {
      if (!dirtyRef.current) return false
      setLeaveAsk({ at: Date.now() })
      return true
    }
    return () => { backGuardRef.current = null }
  }, [backGuardRef])
  function tryBack() {
    if (dirtyRef.current) setLeaveAsk({ at: Date.now() })
    else onBack?.()
  }

  // Загрузка существующего шаблона на маунте.
  useEffect(() => {
    if (isNew) return
    let alive = true
    setLoading(true)
    getTemplate(templateId).then((t) => {
      if (!alive) return
      if (t) {
        const loaded = toItems(t)
        setName(t.name ?? '')
        setItems(loaded)
        setIsPublic(Boolean(t.is_public))
        baseRef.current = formSnapshot(t.name ?? '', loaded, Boolean(t.is_public))
        setReadOnly(t.user_id !== user.id)
        setAuthorName(t.author_name ?? null)
      } else {
        setMessage({ type: 'error', text: 'Шаблон не найден.' })
      }
      setLoading(false)
    }).catch((err) => {
      // Без этого сбой чтения оставлял вечный скелетон.
      if (!alive) return
      setMessage({ type: 'error', text: 'Не удалось открыть шаблон: ' + (err?.message ?? err) })
      setLoading(false)
    })
    return () => { alive = false }
  }, [isNew, templateId, user.id])

  function addExercise(ex) {
    setPickerOpen(false)
    if (items.some((it) => it.exercise.id === ex.id)) {
      // Короткая подсказка, а не «ошибка навсегда» (v6.3.0): гаснет сама через
      // пару секунд и при следующем удачном добавлении.
      setMessage({ type: 'error', text: 'Это упражнение уже в шаблоне', transient: true })
      return
    }
    setMessage((m) => (m?.transient ? null : m))
    setItems([...items, newItem(ex)])
  }

  function newItem(ex) {
    return { exercise: ex, metric: exerciseMetric(ex), set_plan: templatePlan(ex, { sets: ex.metric === 'distance' ? 1 : 3, reps: ex.metric === 'time' ? 60 : ex.metric === 'distance' ? 1800 : 10, weight: 0 }).map((s) => ({ ...s, _k: sk() })) }
  }

  // Набор сканером (8.4.0): все разом, уже стоящие в шаблоне пропускаем.
  function addExercises(list) {
    setPickerOpen(false)
    const fresh = list.filter((ex) => !items.some((it) => it.exercise.id === ex.id))
    const skipped = list.length - fresh.length
    setMessage((m) => (skipped
      ? { type: 'error', text: skipped === list.length ? 'Эти упражнения уже в шаблоне' : `Уже были в шаблоне: ${skipped}`, transient: true }
      : m?.transient ? null : m))
    setItems((prev) => [...prev, ...fresh.filter((ex) => !prev.some((it) => it.exercise.id === ex.id)).map(newItem)])
  }

  // «Убрать» стирает и построчный план упражнения — даем окно отмены, как в тренировке (UI-ревью 23.10).
  // Тост привязан к редактору (kind:'undo'): уход из редактора его гасит.
  useEffect(() => () => hideToast('undo'), [])
  function removeExercise(idx) {
    const removed = items[idx]
    setItems(items.filter((_, i) => i !== idx))
    if (!removed) return
    showToast({
      icon: 'trash', kind: 'undo', title: 'Упражнение убрано', sub: removed.exercise?.name,
      actionLabel: 'Отменить', duration: 4000,
      onAction: () => setItems((prev) => (prev.some((it) => it.exercise.id === removed.exercise.id)
        ? prev
        : [...prev.slice(0, idx), removed, ...prev.slice(idx)])),
    })
  }

  // Правка целевого плана упражнения (подходы/повторы/вес). Значения хранятся
  // как есть из инпутов; нормализация в числа — на сохранении (repo.saveTemplate).
  function updateTarget(idx, field, value) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }

  // ------------------------ перестановка упражнений ------------------------
  // Общая механика hooks/useSortable (v7.1.2): за ☰ строка поднимается и едет за
  // пальцем, соседи расступаются, порядок применяется на отпускании. Alt+↑/↓ на ☰.
  const sortRef = useSortable((id, beforeId) => {
    setItems((prev) => reorderWithPhase(prev, id, beforeId)) // блок — по соседу (разминка/заминка)
  }, {
    attr: 'data-tpl-id', handle: '.tpl-handle',
    // Корзина (fb_df0b21b6): бросил в «Убрать» — как «Убрать» в меню строки, с «Отменить».
    onRemove: (id) => { const i = items.findIndex((it) => String(it.exercise.id) === id); if (i >= 0) removeExercise(i) },
  })

  const canSave = name.trim().length > 0 && items.length > 0 && !saving
  const needName = !name.trim() && items.length > 0

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      await saveTemplate({
        id: isNew ? undefined : templateId,
        user_id: user.id,
        name,
        exercises: items,
        is_public: isPublic,
      })
      if (navigator.onLine) syncNow(user.id)
      onBack?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'Не сохранилось: ' + (err.message ?? err) })
      setSaving(false)
    }
  }

  // Удаление шаблона. Подтверждение — in-app arm/confirm (как в WorkoutScreen /
  // danger-zone профиля), а не нативный window.confirm: единый паттерн по всему
  // приложению (нативные диалоги в PWA выглядят чужеродно).
  async function remove() {
    setSaving(true)
    setMessage(null)
    try {
      await deleteTemplate(templateId)
      if (navigator.onLine) syncNow(user.id)
      onBack?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'Не удалилось: ' + (err.message ?? err) })
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <div className="detail-head">
        <BackButton onClick={tryBack} />
        <h2 className="screen-title detail-title">
          {isNew ? 'Новый шаблон' : 'Шаблон'}
        </h2>
        {/* Удаление — наверху, у заголовка, а не под «Сохранить» (fb_ff55a5d2, fb_b5e4c20f). */}
        {!isNew && !readOnly && !loading && !delArm && (
          <button type="button" className="link-btn danger tpl-del" disabled={saving} onClick={() => setDelArm(true)}>
            Удалить
          </button>
        )}
      </div>

      {delArm && (
        <div className="danger-confirm tpl-del-confirm">
          <p className="danger-text">Удалить этот шаблон? Действие необратимо.</p>
          <div className="danger-actions">
            <button className="btn ghost" onClick={() => setDelArm(false)} disabled={saving}>Отмена</button>
            <button className="btn danger" onClick={remove} disabled={saving}>
              {saving ? 'Удаление…' : 'Да, удалить'}
            </button>
          </div>
        </div>
      )}

      {leaveAsk && (
        <div className="danger-confirm tpl-leave-confirm" ref={leaveRef} role="alert">
          <p className="danger-text">Выйти без сохранения? Правки шаблона пропадут.</p>
          <div className="danger-actions">
            <button type="button" className="btn ghost" onClick={() => setLeaveAsk(null)}>Остаться</button>
            <button type="button" className="btn danger" onClick={() => onBack?.()}>Выйти</button>
          </div>
        </div>
      )}

      {message && (
        <div className={message.type === 'error' ? 'banner error' : 'banner ok'} role={message.type === 'error' ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}

      {loading ? (
        <CardsSkeleton cards={3} />
      ) : readOnly ? (
        // Просмотр чужого общего шаблона: без полей ввода и кнопок.
        <>
          <h3 className="tpl-view-name">{name}</h3>
          {authorName && <p className="muted tpl-author">от {authorName}</p>}

          <ul className="history-list">
            {items.map((it, idx) => {
              const target = fmtTemplateTarget(exerciseMetric(it.exercise), it)
              return (
                <li key={idx} className="history-ex">
                  <span className="history-ex-name">{it.exercise.name}</span>
                  {target && <span className="history-ex-sets">{target}</span>}
                </li>
              )
            })}
          </ul>
          <p className="muted empty">Чужой общий шаблон — только просмотр. Применить можно при создании тренировки.</p>
        </>
      ) : (
        <>
          {/* Без названия шаблон не сохранить (кнопка выключена). Когда упражнения
              уже есть и не хватает только названия — подсвечиваем поле и говорим
              почему, иначе выключенная «Сохранить» выглядит сломанной (v6.3.0). */}
          <label className="date-field">
            <span className="muted">Название</span>
            <input
              className={'search' + (needName ? ' field-need' : '')}
              type="text"
              placeholder="Напр. «Понедельник: спина»"
              value={name}
              aria-invalid={needName || undefined}
              aria-describedby={needName ? 'tpl-name-need' : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {needName && <span id="tpl-name-need" className="field-need-hint">Без названия шаблон не сохранится</span>}
          </label>

          <label className="tpl-toggle">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span>Виден всем</span>
          </label>

          {items.length === 0 && (
            <p className="muted empty">В шаблоне пока нет упражнений</p>
          )}

          <div className="tpl-rows" ref={sortRef}>
          {items.map((it, idx) => {
            const metric = exerciseMetric(it.exercise)
            // Карточка — как упражнение в тренировке (fb_58cbb46a): заголовок + «убрать»,
            // под ним подходы со степперами. ☰ — ручка перестановки упражнений.
            return (
            <Fragment key={it.exercise.id}>
            {phaseHeading(items, idx) && <p className="sec-title wk-phase-title">{phaseHeading(items, idx)}</p>}
            <div
              data-tpl-id={it.exercise.id}
              className={'card exercise-card tpl-ex' + (metric === 'time' ? ' count' : '')}
            >
              <div className="exercise-head">
                <span className="tpl-ex-title">
                  <button
                    type="button"
                    className="tpl-handle"
                    aria-label="Перетащить"
                    title="Перетащить (или Alt + ↑/↓)"
                  >
                    <Icon name="grip" size={20} />
                  </button>
                  <span className="exercise-title tpl-name">{it.exercise.name}</span>
                </span>
                <span className="exercise-actions">
                  {/* Блок: разминка / основная часть / заминка (23.10.2026, fb_c2774110) — переносится в тренировку. */}
                  <MoreMenu label={`Блок «${it.exercise.name}»`} open={phaseMenu === it.exercise.id}
                    onToggle={() => setPhaseMenu((v) => (v === it.exercise.id ? null : it.exercise.id))}
                    onClose={() => setPhaseMenu(null)} btnClassName="link-btn exercise-phase-btn">
                    {PHASES.filter((p) => p !== phaseOf(it)).map((p) => (
                      <button key={p} type="button" role="menuitem"
                        onClick={() => { setPhaseMenu(null); setItems((prev) => setEntryPhase(prev, prev.indexOf(it), p)) }}>
                        {PHASE_MOVE_LABEL[p]}
                      </button>
                    ))}
                  </MoreMenu>
                  <button className="link-btn danger" onClick={() => removeExercise(idx)}>
                    убрать
                  </button>
                </span>
              </div>
              <TemplateSets metric={metric} sets={it.set_plan}
                onChange={(plan) => updateTarget(idx, 'set_plan', plan)} />
            </div>
            </Fragment>
            )
          })}
          </div>

          <button className="add-btn tpl-add-ex" onClick={() => setPickerOpen(true)}>
            <Icon name="plus" size={17} strokeWidth={2.4} />Добавить упражнение
          </button>

          <button className="btn primary full save-btn" disabled={!canSave} onClick={save}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>

        </>
      )}

      <ScrollTopButton />

      {/* onCreate: владелец нового упражнения — вошедший (см. WorkoutScreen). */}
      {pickerOpen && (
        <ExercisePicker
          exercises={exercises}
          favorites={favorites}
          onToggleFavorite={(id) => toggleFavorite(user.id, id)}
          onPick={addExercise}
          onPickMany={addExercises}
          onCreate={(p) => createExercise({ ...p, owner_id: user.id })}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
