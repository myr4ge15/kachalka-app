import { useState, useEffect, useRef, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises, getWorkout, getWorkouts, saveWorkout, createExercise, deleteWorkout as repoDelete, getRecentSessionsForExercise, getProgSettings, setProgForExercise, saveTemplate, setWorkoutFeels, getFavorites, toggleFavorite } from '../db/repo.js'
import { detectNewPrsOnSave, detectGoalReachedOnSave } from '../db/notifications.js'
import { detectInsightsOnSave } from '../db/insights.js'
import { detectBadgesOnSave } from '../db/badges.js'
import { syncNow } from '../db/sync.js'
import { showToast, hideToast } from '../components/ui/Toast.jsx'
import { buildRecommendation, defaultSet } from '../lib/progressionCard.js'
import { workoutFinishEvents } from '../lib/workoutFinish.js'
import {
  appendExerciseIn, removeExerciseIn, insertExerciseIn, replaceExerciseIn,
  updateSetIn, stepSetIn, addSetIn, putSetIn, removeSetIn, insertSetIn,
  revertProgIn, applyProgIn, toggleProgSettingsIn, setsFromTemplate, countSavable,
} from '../lib/workoutEntries.js'
import { exportWorkouts } from '../lib/exportWorkout.js'
import { templateExercisesFromWorkout, defaultTemplateName } from '../lib/templateFromWorkout.js'
import { vibrate, HAPTIC } from '../lib/haptics.js'
import { exerciseUsageSections } from '../lib/exerciseUsage.js'
import { useWorkoutFocus } from '../hooks/useWorkoutFocus.js'
import { useWorkoutDraft } from '../hooks/useWorkoutDraft.js'
import { useRestTimer } from '../hooks/useRestTimer.js'
import { localYmd } from '../lib/calendar.js'
import { useSortable } from '../hooks/useSortable.js'
import { reorderExercises } from '../lib/reorderExercises.js'
import CardsSkeleton from '../components/ui/CardsSkeleton.jsx'
import ExercisePicker from '../components/exercises/ExercisePicker.jsx'
import TechniqueSheet from '../components/exercises/TechniqueSheet.jsx'
import { techniqueSlugFor } from '../lib/technique.js'
import TemplatePicker from '../components/templates/TemplatePicker.jsx'
import ExerciseCard from '../components/exercises/ExerciseCard.jsx'
import DateField from '../components/ui/DateField.jsx'
import WorkoutActions from '../components/workout/WorkoutActions.jsx'
import SaveBar from '../components/workout/SaveBar.jsx'
import RestPill from '../components/workout/RestPill.jsx'
import RestSheet from '../components/workout/RestSheet.jsx'
import { AppMarkGlyph } from '../components/app/AppMark.jsx'
import BackButton from '../components/ui/BackButton.jsx'

// Экран-композер (новая тренировка) и экран-деталь (правка существующей).
//   workoutId == null → новая (черновик в кэше переживает уход с экрана)
//   workoutId != null → существующая (читаем из документа, кэш не трогаем)
export default function WorkoutScreen({ user, workoutId = null, onBack, onSaved }) {
  const isNew = workoutId == null
  // Справочник — из локальной базы (офлайн-доступен).
  const exercises = useLiveQuery(() => getExercises(), [], [])
  // Подсказка карточки — по ТЕКУЩЕЙ записи каталога (не по снимку в тренировке):
  // переименованное, скрытое или удаленное упражнение подсказку не получает.
  const techniqueById = useMemo(() => {
    const map = new Map()
    for (const ex of exercises) {
      const slug = techniqueSlugFor(ex)
      if (slug) map.set(String(ex.id), { slug, name: ex.name })
    }
    return map
  }, [exercises])
  const exerciseUsage = useLiveQuery(
    () => getWorkouts(user.id).then((workouts) => exerciseUsageSections(workouts)),
    [user.id],
    { recent: [], frequent: [] }
  )
  // Настройки автопрогрессии (глобальный тумблер + пер-упражнение). Дефолт до
  // загрузки — включено (как и первый резолв в repo.getProgSettings).
  const prog = useLiveQuery(() => getProgSettings(user.id), [user.id], { enabled: true, byExercise: {} })
  // ⭐ Избранные упражнения (v6.5.0) — блок сверху пикера, синкаются через user_meta.
  const favorites = useLiveQuery(() => getFavorites(user.id), [user.id], [])

  // Сообщение экрана (ошибка/успех). Короткие подсказки («уже добавлено») гаснут
  // сами через 2,5 с и при следующем удачном добавлении (v6.3.3).
  const [message, setMessage] = useState(null) // {type, text, transient?}
  useEffect(() => {
    if (!message?.transient) return
    const t = setTimeout(() => setMessage((m) => (m === message ? null : m)), 2500)
    return () => clearTimeout(t)
  }, [message])

  // Состав, оценки RPE, дата и их черновик (новая — до сохранения, правка — до
  // сохранения или «Вернуть как было») — hooks/useWorkoutDraft.js.
  const draft = useWorkoutDraft({
    userId: user.id,
    workoutId,
    onLoadError: (text) => setMessage({ type: 'error', text }),
  })
  const { entries, setEntries, feels, setFeels, performedAt, setPerformedAt, loading, editRestored } = draft
  // Перестановка (v7.1.2, общий hooks/useSortable): удержание заголовка → строка
  // поднимается и едет за пальцем. Раскрытая карточка на время жеста сворачивается
  // в строку — тащить высокую карточку неудобно; активной она остается.
  const [dragFolded, setDragFolded] = useState(null)
  const reorderRef = useSortable((id, beforeId) => {
    activateExercise(activeExerciseId)
    setEntries(prev => reorderExercises(prev, id, beforeId))
  }, {
    attr: 'data-exercise-id',
    handle: '.exercise-compact-toggle, .exercise-title',
    holdMs: 350,
    onLift: id => { if (id === activeExerciseId) setDragFolded(id) },
    onDrop: () => setDragFolded(null),
  })
  // Сохраненная — все упражнения свернуты, раскрывает человек (fb_223cf43d).
  const { activeExerciseId, activeCardRef, activateExercise } = useWorkoutFocus(entries, {
    preferIncomplete: !isNew,
    startCollapsed: !isNew,
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  // null → пикер в режиме «добавить»; число → индекс entry, который заменяем.
  const [replaceIdx, setReplaceIdx] = useState(null)
  const [tplPickerOpen, setTplPickerOpen] = useState(false)
  // Подсказка «Как выполнять» из карточки (v8.0.0): { slug, name } или null.
  // Только чтение справочника — состав и черновик тренировки она не трогает.
  const [technique, setTechnique] = useState(null)
  const [voiceCursor, setVoiceCursor] = useState({}) // { [exerciseId]: строка для голоса }
  const [saving, setSaving] = useState(false)
  const [delArm, setDelArm] = useState(false)   // in-app подтверждение удаления (как везде)
  const [clearArm, setClearArm] = useState(false) // подтверждение отказа от черновика новой
  // «Сделать шаблон из тренировки»: раскрытая форма с именем + занятость.
  const [tplArm, setTplArm] = useState(false)
  const [tplName, setTplName] = useState('')
  const [tplBusy, setTplBusy] = useState(false)
  // Таймер отдыха (v8.8.0): только у НОВОЙ тренировки за сегодня — запись задним
  // числом отдыха не требует. Состояние и сигналы — hooks/useRestTimer.js. С v8.8.1
  // кнопка — в раскрытой карточке упражнения рядом с «+ подход» (не в шапке): длинную
  // тренировку не надо листать наверх, а пустая тренировка таймера не показывает.
  const [restOpen, setRestOpen] = useState(false)
  const activeExercise = entries.find((e) => e.exercise.id === activeExerciseId)?.exercise ?? null
  // «Сегодня» — день, когда открыли экран записи, а не текущие часы (20.10.2026): в полночь
  // тренировка, начатая в 23:5x, переставала быть «сегодняшней», и идущий отдых гас вместе с пушем.
  const [openDay] = useState(() => localYmd(new Date()))
  const isToday = !loading && localYmd(performedAt) === openDay
  const restShown = isNew && isToday
  const rest = useRestTimer(user.id, { exercise: activeExercise, ready: !loading, active: restShown })
  const restVisible = restShown && rest.settings.on
  function tapRest() {
    if (rest.state.phase === 'run') setRestOpen(true)
    else rest.start()
  }



  // Undo-тост удаления привязан к ЭТОМУ экрану: его «Отменить» зовет setEntries,
  // которого после ухода со страницы уже нет. Поэтому при размонтировании гасим
  // его (kind:'undo') — смена вкладки/возврат к списку убирают зависший тост.
  useEffect(() => () => hideToast('undo'), [])

  // Серия подходов, удаленных подряд под одним undo-тостом (РЕВЬЮ-КОДА-2026-10-02):
  // у тоста один слот, и раньше «Отменить» возвращало только последний подход.
  // Копим [{ exId, si, set }] в ref, пока тост висит; сбрасываем в его onClose
  // (таймер, «Отменить», замена другим тостом, уход с экрана).
  const removedSetsRef = useRef(null)


  function openAddPicker() {
    setReplaceIdx(null)
    setPickerOpen(true)
  }

  function openReplacePicker(idx) {
    setReplaceIdx(idx)
    setPickerOpen(true)
  }

  function closePicker() {
    setPickerOpen(false)
    setReplaceIdx(null)
  }

  // Роутер выбора из пикера: добавить новое упражнение или заменить существующее.
  function handlePick(ex) {
    if (replaceIdx != null) replaceExercise(replaceIdx, ex)
    else addExercise(ex)
  }

  async function addExercise(ex) {
    if (entries.some((e) => e.exercise.id === ex.id)) {
      setPickerOpen(false)
      setMessage({ type: 'error', text: 'Это упражнение уже добавлено', transient: true })
      return
    }
    setMessage((m) => (m?.transient ? null : m))
    // Автопрогрессия (PLAN-autoprogression): вместо немой копии прошлого подхода
    // предзаполняем РЕКОМЕНДАЦИЕЙ («+вес/тот же/−вес») и показываем панель с
    // причиной и откатом. Нет истории/выключено/ручной → копия или дефолт. Данные
    // локальные — сеть не нужна.
    let built
    try {
      const sessions = await getRecentSessionsForExercise(user.id, ex.id, 5)
      built = buildRecommendation(ex, sessions, prog)
    } catch {
      built = { sets: [defaultSet(ex)], meta: null }
    }
    // Закрываем пикер только вместе с добавлением готовой карточки. Иначе между
    // этими событиями пустой композер успевает отрисоваться, и в desktop
    // master-detail потоковая кнопка «Сохранить» заметно прыгает вниз.
    // Пока читали историю, состав мог измениться (двойной тап/undo) — анти-дубль
    // остается на свежем состоянии внутри апдейтера.
    setEntries((prev) => appendExerciseIn(prev, ex, built.sets, built.meta))
    activateExercise(ex.id)
    setPickerOpen(false)
  }

  // Набор сканером (8.4.0): несколько упражнений разом, в порядке сканирования.
  // Рекомендации читаем параллельно; уже добавленные пропускаем и говорим об этом
  // одной подсказкой. Активным становится первое новое.
  async function addExercises(list) {
    const fresh = list.filter((ex) => !entries.some((e) => e.exercise.id === ex.id))
    const skipped = list.length - fresh.length
    const built = await Promise.all(fresh.map(async (ex) => {
      try {
        const sessions = await getRecentSessionsForExercise(user.id, ex.id, 5)
        return buildRecommendation(ex, sessions, prog)
      } catch {
        return { sets: [defaultSet(ex)], meta: null }
      }
    }))
    setEntries((prev) => fresh.reduce((acc, ex, i) => appendExerciseIn(acc, ex, built[i].sets, built[i].meta), prev))
    if (fresh.length) activateExercise(fresh[0].id)
    setMessage((m) => (skipped
      ? { type: 'error', text: skipped === list.length ? 'Эти упражнения уже добавлены' : `Уже были в тренировке: ${skipped}`, transient: true }
      : m?.transient ? null : m))
    setPickerOpen(false)
  }

  // Оценка «как пошло» (RPE). Повторный тап по выбранной кнопке СНИМАЕТ оценку:
  // она необязательна, и промах не должен фиксироваться навсегда — а отдельной
  // кнопки «убрать» ради этого заводить незачем.
  function setFeel(exerciseId, feel) {
    setFeels((prev) => {
      const next = { ...prev }
      if (next[exerciseId] === feel) delete next[exerciseId]
      else next[exerciseId] = feel
      return next
    })
    vibrate(HAPTIC.tap)
  }

  // Откат к чистой копии прошлой сессии (ссылка «вернуть как в прошлый раз»).
  function revertProg(ei) {
    setEntries((prev) => revertProgIn(prev, ei))
  }

  // Повторно накатить рекомендацию после отката/ручной правки («Применить»).
  function applyProg(ei) {
    setEntries((prev) => applyProgIn(prev, ei))
  }

  // Показать/спрятать настройки прогрессии (шестеренка) в карточке.
  function toggleProgSettings(ei) {
    setEntries((prev) => toggleProgSettingsIn(prev, ei))
  }

  // Сохранить пер-упражненческую настройку (стратегия/шаг) и пересобрать
  // рекомендацию карточки, не дожидаясь обновления live-query prog.
  async function changeProgSettings(ei, patch) {
    const entry = entries[ei]
    if (!entry) return
    await setProgForExercise(user.id, entry.exercise.id, patch)
    const nextProg = {
      enabled: prog.enabled,
      byExercise: {
        ...prog.byExercise,
        [entry.exercise.id]: { ...(prog.byExercise[entry.exercise.id] ?? {}), ...patch },
      },
    }
    let sessions = []
    try { sessions = await getRecentSessionsForExercise(user.id, entry.exercise.id, 5) } catch { /* локальное чтение */ }
    const built = buildRecommendation(entry.exercise, sessions, nextProg)
    setEntries((prev) => prev.map((e, i) => {
      if (i !== ei) return e
      const wasApplied = !e.fromTemplate && e.prog?.applied !== false
      if (!built.meta) {
        // нет панели (активная стратегия без истории / глобально выкл) — убираем;
        // применявшим рекомендацию возвращаем копию прошлого, ручную правку не трогаем.
        return { ...e, prog: null, sets: wasApplied ? built.sets : e.sets }
      }
      // Держим шестеренку открытой после переключения (в т.ч. на ручной/выкл —
      // строка-заглушка остается, стратегию можно вернуть). Для полной рекомендации
      // сохраняем applied; sets меняем, только если рекомендация была применена.
      return {
        ...e,
        prog: { ...built.meta, settingsOpen: true, applied: built.meta.muted ? undefined : wasApplied },
        sets: wasApplied ? built.sets : e.sets,
      }
    }))
  }

  // Замена упражнения в записи: подходы сохраняем (не вводить заново). Для
  // не-весового нового упражнения обнуляем weight — инвариант «вес=0 у не-весовых».
  function replaceExercise(idx, ex) {
    setPickerOpen(false)
    setReplaceIdx(null)
    const cur = entries[idx]
    if (!cur || cur.exercise.id === ex.id) return
    if (entries.some((e, i) => i !== idx && e.exercise.id === ex.id)) {
      setMessage({ type: 'error', text: 'Это упражнение уже добавлено', transient: true })
      return
    }
    setMessage((m) => (m?.transient ? null : m))
    setEntries((prev) => replaceExerciseIn(prev, idx, ex))
    // Оценка привязана к тому же id и переезжает вместе с подходами: усилие было
    // то же самое, поменялась только запись о том, каким упражнением оно названо.
    setFeels((prev) => {
      if (!(cur.exercise.id in prev)) return prev
      const next = { ...prev, [ex.id]: prev[cur.exercise.id] }
      delete next[cur.exercise.id]
      return next
    })
    activateExercise(ex.id)
  }

  function removeExercise(idx) {
    const removed = entries[idx]
    setEntries((prev) => removeExerciseIn(prev, idx))
    if (!removed) return
    // Убрали открытую карточку — раскрываем соседнюю (ту, что встала на ее место,
    // а у последней — предыдущую), а не первую в списке: иначе экран уезжал к
    // началу тренировки (v6.7.2).
    if (removed.exercise?.id === activeExerciseId) {
      const neighbor = entries[idx + 1] ?? entries[idx - 1]
      if (neighbor) activateExercise(neighbor.exercise.id)
    }
    // Удаление срабатывает сразу, но даем окно отмены — кнопка удаления
    // соседствует с зоной сохранения/добавления, легко нажать случайно.
    showToast({
      emoji: '🗑',
      kind: 'undo', // привязан к экрану — гасится при размонтировании WorkoutScreen
      title: 'Упражнение убрано',
      sub: removed.exercise?.name,
      actionLabel: 'Отменить',
      duration: 4000, // дольше дефолтных 3 c (нужно окно отмены), но не 6 — «висел»
      raised: true, // выше липкой кнопки «Сохранить» — чтобы не перекрывала ее
      onAction: () => {
        setEntries((prev) => insertExerciseIn(prev, idx, removed))
        activateExercise(removed.exercise.id)
      },
    })
  }

  // Применение шаблона (только новая тренировка): добавляем упражнения шаблона,
  // которых еще нет (анти-дубль по exercise.id), каждому — подходы по целевому
  // плану шаблона (подходы × повторы × вес), либо один дефолтный, если плана нет.
  // Рекомендацию автопрогрессии показываем СПРАВОЧНО (applied:false): план шаблона
  // в подходах остается, панель лишь подсказывает «прошлая → рекомендуем сегодня»
  // с кнопкой «Применить рекомендацию» (перебивает план шаблона по желанию).
  async function applyTemplate(tpl) {
    setTplPickerOpen(false)
    const have = new Set(entries.map((e) => e.exercise.id))
    const items = [...(tpl.exercises ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .filter((item) => (item.exercise?.id ?? item.exercise_id) && !have.has(item.exercise?.id ?? item.exercise_id))
    if (items.length === 0) {
      // Тостом, а не баннером: шаблон выбирают внизу экрана, баннер вверху был не виден и
      // висел до сохранения, даже после очистки тренировки (проверка на iPhone 23.10).
      showToast({ emoji: '📋', title: 'Все упражнения шаблона уже добавлены', raised: true })
      return
    }
    const toAdd = []
    for (const item of items) {
      const ex = { ...(item.exercise ?? { id: item.exercise_id, name: '—' }), ...(item.metric ? { metric: item.metric } : {}) }
      const sets = setsFromTemplate(ex, item)
      // Рекомендация справочно: план шаблона в sets не подменяем, панель — не
      // примененная (applied:false). Нет истории/выключено → панели нет (meta:null).
      let meta = null
      try {
        const sessions = await getRecentSessionsForExercise(user.id, ex.id, 5)
        const built = buildRecommendation(ex, sessions, prog)
        meta = built.meta ? { ...built.meta, applied: built.meta.muted ? undefined : false } : null
      } catch { /* рекомендация необязательна */ }
      toAdd.push({ exercise: ex, sets, prog: meta, fromTemplate: true })
    }
    // Пока читали историю, состав мог измениться — анти-дубль на свежем состоянии.
    setEntries((prev) => {
      const cur = new Set(prev.map((e) => e.exercise.id))
      const fresh = toAdd.filter((e) => !cur.has(e.exercise.id))
      return fresh.length ? [...prev, ...fresh] : prev
    })
    activateExercise(toAdd[0]?.exercise?.id)
  }

  function updateSet(ei, si, field, value) {
    setEntries((prev) => updateSetIn(prev, ei, si, field, value))
  }

  function step(ei, si, field, delta) {
    setEntries((prev) => stepSetIn(prev, ei, si, field, delta))
  }

  function addSet(ei) {
    setEntries((prev) => addSetIn(prev, ei))
  }

  // Подход голосом (v8.7.0): SetVoice уже показал и подтвердил, что и куда пишем.
  // Курсор — следующая строка после записанной: «60 на 12» подряд идут по подходам.
  // Живет только в памяти экрана: после перезагрузки голос снова предложит первую
  // строку, а человек увидит ее в карточке и выберет другую.
  function voiceSet(ei, si, set) {
    const exId = entries[ei]?.exercise.id
    setEntries((prev) => putSetIn(prev, ei, si, set))
    if (exId != null) setVoiceCursor((c) => ({ ...c, [exId]: si + 1 }))
  }

  function removeSet(ei, si) {
    const entry = entries[ei]
    const removed = entry?.sets[si]
    setEntries((prev) => removeSetIn(prev, ei, si))
    if (!removed) return
    // Точечная отмена: ищем упражнение по id (индекс мог сдвинуться) и
    // возвращаем подход на прежнее место. Серия — новый массив: onClose
    // вытесненного тоста сравнивает ref со СВОЕЙ серией и не сотрет эту.
    const series = [...(removedSetsRef.current ?? []), { exId: entry.exercise.id, si, set: removed, name: entry.exercise?.name }]
    const names = [...new Set(series.map((r) => r.name).filter(Boolean))]
    showToast({
      emoji: '🗑',
      kind: 'undo', // привязан к экрану — гасится при размонтировании WorkoutScreen
      title: series.length > 1 ? `Подходов удалено: ${series.length}` : 'Подход удален',
      sub: names.join(', ') || undefined,
      actionLabel: 'Отменить',
      duration: 4000, // дольше дефолтных 3 c (нужно окно отмены), но не 6 — «висел»
      raised: true, // выше липкой кнопки «Сохранить» — чтобы не перекрывала ее
      // Возвращаем в обратном порядке: каждый si записан для состояния ПОСЛЕ
      // предыдущих удалений, так что откат с конца восстанавливает исходные места.
      onAction: () => setEntries((prev) => series.reduceRight(
        (acc, r) => insertSetIn(acc, r.exId, r.si, r.set), prev)),
      onClose: () => { if (removedSetsRef.current === series) removedSetsRef.current = null },
    })
    removedSetsRef.current = series
  }

  // Что в строках — то и записывается (и в новой, и в правке); подхода, которого
  // не было, удаляется ✕ (с undo-тостом). Упражнение без подходов не сохраняется.
  const entriesToSave = entries.filter((e) => e.sets.length > 0)
  // Считаем ровно то, что запишется: строка без повторов (или с нечисловым весом)
  // в запись не попадает — о таких говорим прямо под кнопкой, а не молча теряем.
  const { sets: totalSets, skipped: skippedSets } = countSavable(entriesToSave)
  const canSave = totalSets > 0 && !saving

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const wId = await saveWorkout({
        id: isNew ? undefined : workoutId,
        user_id: user.id,
        performed_at: performedAt,
        entries: entriesToSave,
      })
      // Итог строится из уже записанного локального документа. Если чтение
      // неожиданно не удалось, успешное сохранение все равно не блокируем:
      // форма содержит тот же состав и годится как безопасный фолбэк.
      let savedWorkout
      try { savedWorkout = await getWorkout(wId) } catch { /* локальная сводка необязательна */ }
      savedWorkout ??= {
        id: wId,
        user_id: user.id,
        performed_at: performedAt,
        entries: entriesToSave,
      }
      // Оценки пишем ПОСЛЕ сохранения — только здесь известен id тренировки.
      // Пишем лишь по упражнениям, реально попавшим в запись: упражнение без
      // подходов не сохраняется, и его оценка осталась бы висеть без хозяина. Неудача записи оценок не откатывает
      // успешно сохраненную тренировку — она необязательная надстройка.
      try {
        const saved = new Set(entriesToSave.map((e) => e.exercise.id))
        const kept = Object.fromEntries(Object.entries(feels).filter(([exId]) => saved.has(exId)))
        await setWorkoutFeels(user.id, wId, performedAt, kept)
      } catch { /* оценки необязательны, тренировка уже записана */ }
      draft.dropSaved() // и оценки, и дата: следующая тренировка начинается без них
      if (isNew) rest.stop() // занятие закончено — отдых и его пуш больше не нужны
      // Тактильный отклик по итогу сохранения: рекорд/цель — «праздничный»
      // паттерн, обычное сохранение — короткий success (см. lib/haptics.js).
      let finishEvents = []
      // Главное событие итогового экрана (ТЗ §4.5). Только для новой
      // тренировки — чтобы повторная правка старой записи не поднимала ложный
      // рекорд. Рекорды считаются из локальных данных, сеть не нужна.
      if (isNew) {
        try {
          // Детект — с побочными эффектами (цель штампует achievedAt, бейджи —
          // meta), поэтому зовем ВСЕГДА и по порядку. detectBadgesOnSave всегда
          // размечает новые вехи (для экрана и колокольчика), даже если тост
          // перекрыт рекордом/целью.
          const prs = await detectNewPrsOnSave(user.id, wId)
          const reached = await detectGoalReachedOnSave(user.id, wId)
          const newBadges = await detectBadgesOnSave(user.id)
          // Инсайт тянем только для «тихой» тренировки (ничего праздничного не
          // сработало) — detectInsightsOnSave читает лидерборд/историю, лишний раз
          // не гоняем. Выбор ЕДИНОГО события и приоритет — чистый
          // workoutFinishEvents; визуально они живут в finish-sheet, не в тосте.
          const quiet = !prs.length && !reached.length && !newBadges.length
          const insights = quiet ? await detectInsightsOnSave(user.id, wId, { max: 1 }) : []
          finishEvents = workoutFinishEvents({ prs, reached, newBadges, insights })
        } catch { /* главное событие необязательно, сохранение уже успешно */ }
      }
      vibrate(finishEvents[0]?.celebrated ? HAPTIC.celebrate : HAPTIC.success)
      if (navigator.onLine) syncNow(user.id)
      // Итоговый экран — событие ЗАВЕРШЕНИЯ занятия, а не сохранения документа.
      // Правка старой записи ничего не завершает: событий у нее нет по построению
      // (рекорды/цели считаются только для новой), и шит выходил пустой сводкой с
      // «Тренировка готова» поверх тренировки недельной давности. Поэтому правка —
      // тихий возврат в список: экран закрылся и запись в списке обновилась, это
      // и есть подтверждение (плюс HAPTIC.success выше).
      if (isNew && onSaved) onSaved({ workout: savedWorkout, events: finishEvents })
      else onBack?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'Не сохранилось: ' + (err.message ?? err) })
      setSaving(false)
    }
  }

  // Отказ от новой тренировки. Экран «Назад» намеренно СОХРАНЯЕТ черновик в кэше
  // (случайный уход не теряет набранный состав — в т.ч. упражнения из шаблона),
  // поэтому явный отказ вынесен в отдельную кнопку: чистим кэш + состав, но
  // ОСТАЕМСЯ на экране новой тренировки (пустой composer), а не уходим в список —
  // пользователь ждет, что продолжит добавлять с чистого листа. Уйти — «← Назад».
  function clearDraft() {
    draft.clearDraft()
    setClearArm(false)
  }

  // Экспорт этой тренировки в JSON-файл (из текущего состава формы).
  function exportOne() {
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    // Экспортируем то, что уйдет в запись: в правке снятые подходы уже не ее часть.
    exportWorkouts(
      { id: workoutId, performed_at: performedAt, created_at: null, entries: entriesToSave },
      appVersion
    )
  }

  // Раскрыть форму «Сделать шаблон из тренировки» с предзаполненным именем.
  function openTplArm() {
    setTplName(defaultTemplateName(performedAt))
    setMessage(null)
    setTplArm(true)
  }

  // Создать шаблон из текущего состава тренировки: план (подходы × повторы × вес)
  // сохраняем для каждого подхода без сведения к одному лучшему (см. lib/templateFromWorkout.js).
  // Приватный шаблон (is_public:false) — как «Новый шаблон» в разделе «Шаблоны».
  async function makeTemplate() {
    setTplBusy(true)
    setMessage(null)
    try {
      const exercises = templateExercisesFromWorkout(entriesToSave)
      if (exercises.length === 0) throw new Error('В тренировке нет упражнений с подходами.')
      await saveTemplate({ user_id: user.id, name: tplName, exercises, is_public: false })
      setTplArm(false)
      if (navigator.onLine) syncNow(user.id)
      vibrate(HAPTIC.success)
      showToast({ emoji: '📋', title: 'Шаблон создан', sub: tplName.trim() })
    } catch (err) {
      setMessage({ type: 'error', text: 'Не удалось создать шаблон: ' + (err?.message ?? err) })
    } finally {
      setTplBusy(false)
    }
  }

  // Удаление тренировки. Подтверждение — in-app arm/confirm (как «удалить мои
  // данные»/dead-letter), а не нативный window.confirm — единый паттерн по всему
  // приложению.
  async function remove() {
    setSaving(true)
    setMessage(null)
    try {
      await repoDelete(workoutId)
      draft.dropSaved()
      if (navigator.onLine) syncNow(user.id)
      onBack?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'Не удалилось: ' + (err.message ?? err) })
      setSaving(false)
    }
  }

  const workoutActions = (
    <WorkoutActions
      isNew={isNew}
      hasEntries={entries.length > 0}
      saving={saving}
      tplBusy={tplBusy}
      clearArm={clearArm}
      onCancelClear={() => setClearArm(false)}
      onClearDraft={clearDraft}
      onExport={exportOne}
      tplArm={tplArm}
      onOpenTpl={openTplArm}
      onCancelTpl={() => setTplArm(false)}
      tplName={tplName}
      onTplName={setTplName}
      onMakeTemplate={makeTemplate}
      delArm={delArm}
      onArmDel={() => setDelArm(true)}
      onCancelDel={() => setDelArm(false)}
      onDelete={remove}
    />
  )

  return (
    <div className="screen workout-screen" ref={reorderRef}>
      {/* Шапка (v6.1.0): круглая «назад», заголовок, дата чипом под ним (тап —
          пикер, так начинается запись задним числом), «Очистить» справа — только
          у новой тренировки с составом; подтверждение раскрывается под шапкой. */}
      <div className="wk-head">
        <BackButton onClick={() => onBack?.()} />
        <div className="wk-head-main">
          <h2 className="screen-title wk-title">{isNew ? 'Новая тренировка' : 'Тренировка'}</h2>
          {!loading && <DateField performedAt={performedAt} onChange={setPerformedAt} />}
        </div>
        {isNew && entries.length > 0 && !clearArm && (
          <button className="wk-clear" disabled={saving} onClick={() => setClearArm(true)}>
            Очистить
          </button>
        )}
      </div>

      {message && (
        <div className={message.type === 'error' ? 'banner error' : 'banner ok'}>
          {message.text}
        </div>
      )}

      {editRestored && !loading && (
        <div className="banner edit-restored" role="status">
          <span>Здесь несохраненные правки с прошлого раза.</span>
          <button className="link-btn" onClick={draft.revertEdits}>Вернуть как было</button>
        </div>
      )}

      {loading ? (
        <CardsSkeleton cards={3} />
      ) : (
        <>
          {/* Подтверждение очистки черновика — сразу под шапкой: не прячется под
              липкой «Сохранить» и не требует прокрутки длинного состава. */}
          {isNew && workoutActions}

          {entries.length === 0 && (
            <div className="wk-empty">
              <span className="wk-empty-mark" aria-hidden="true"><AppMarkGlyph width="64" height="39" /></span>
              <b>Добавь упражнение, чтобы начать</b>
              {isNew && <span>Или возьми шаблон — подходы и веса подставятся сами.</span>}
            </div>
          )}

          {entries.length > 1 && <p className="muted exercise-reorder-hint">Зажми название упражнения и перетащи, чтобы изменить порядок.</p>}
          {entries.map((entry, ei) => (
            <ExerciseCard
              key={entry.exercise.id}
              entry={entry}
              ei={ei}
              prog={prog}
              active={entry.exercise.id === activeExerciseId && dragFolded !== entry.exercise.id}
              cardRef={entry.exercise.id === activeExerciseId && dragFolded !== entry.exercise.id ? activeCardRef : null}
              onActivate={activateExercise}
              feel={feels[entry.exercise.id] ?? null}
              onSetFeel={setFeel}
              onTechnique={techniqueById.has(String(entry.exercise.id))
                ? () => setTechnique(techniqueById.get(String(entry.exercise.id)))
                : null}
              onReplace={openReplacePicker}
              onRemove={removeExercise}
              onRevertProg={revertProg}
              onApplyProg={applyProg}
              onToggleProgSettings={toggleProgSettings}
              onChangeProgSettings={changeProgSettings}
              onUpdateSet={updateSet}
              onStep={step}
              onAddSet={addSet}
              onRemoveSet={removeSet}
              onVoiceSet={voiceSet}
              voiceCursor={voiceCursor[entry.exercise.id] ?? 0}
              restSlot={restVisible && entry.exercise.id === activeExerciseId
                ? <RestPill state={rest.state} idleSec={rest.idleSec} onTap={tapRest} />
                : null}
            />
          ))}

          <div className={`wk-adds${isNew ? '' : ' one'}`}>
            <button className="wk-add" onClick={openAddPicker} aria-label="Добавить упражнение">
              <PlusIcon />Упражнение
            </button>
            {isNew && (
              <button className="wk-add" onClick={() => setTplPickerOpen(true)} aria-label="Выбрать шаблон">
                <TplIcon />Шаблон
              </button>
            )}
          </div>

          {!isNew && workoutActions}

          <SaveBar canSave={canSave} saving={saving} totalSets={totalSets} skippedSets={skippedSets} onSave={save} />
        </>
      )}

      {/* onCreate: владельца проставляем здесь, а не в repo — тот не знает, кто
          вошел. Справочник упражнений общий на весь круг, и без owner_id новое
          упражнение осталось бы ничьим, а каталог снова показывал бы всем одно
          и то же (баг «Мои упражнения одинаковые у разных людей»). */}
      {pickerOpen && (
        <ExercisePicker
          exercises={exercises}
          usage={exerciseUsage}
          favorites={favorites}
          onToggleFavorite={(id) => toggleFavorite(user.id, id)}
          techniqueSlugOf={techniqueSlugFor}
          title={replaceIdx != null ? 'Заменить упражнение' : 'Упражнение'}
          onPick={handlePick}
          onPickMany={replaceIdx == null ? addExercises : undefined}
          replacing={replaceIdx != null}
          onCreate={(p) => createExercise({ ...p, owner_id: user.id })}
          onClose={closePicker}
        />
      )}

      {restOpen && restVisible && (
        <RestSheet
          state={rest.state}
          run={rest.run}
          idleSec={rest.idleSec}
          settings={rest.settings}
          exerciseName={activeExercise?.name ?? null}
          onStart={() => rest.start()}
          onChoose={rest.choose}
          onAdjust={rest.adjust}
          onStop={rest.stop}
          onSettings={rest.setSettings}
          onHide={() => { rest.stop(); rest.setSettings({ on: false }); setRestOpen(false) }}
          onClose={() => setRestOpen(false)}
        />
      )}

      {technique && (
        <TechniqueSheet slug={technique.slug} name={technique.name} onClose={() => setTechnique(null)} />
      )}

      {tplPickerOpen && (
        <TemplatePicker
          user={user}
          onPick={applyTemplate}
          onClose={() => setTplPickerOpen(false)}
        />
      )}
    </div>
  )
}

// Иконки кнопок добавления — инлайн-SVG (как TabIcon), красятся currentColor.
function PlusIcon() {
  return (
    <svg className="wk-add-ico" viewBox="0 0 24 24" width="18" height="18" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function TplIcon() {
  return (
    <svg className="wk-add-ico" viewBox="0 0 24 24" width="18" height="18" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M9 10h6M9 14h6" />
    </svg>
  )
}
