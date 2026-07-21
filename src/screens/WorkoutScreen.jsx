import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getExercises, getWorkout, saveWorkout, createExercise, deleteWorkout as repoDelete, getRecentSessionsForExercise, getProgSettings, setProgForExercise, saveTemplate } from '../db/repo.js'
import { detectNewPrsOnSave, detectGoalReachedOnSave } from '../db/notifications.js'
import { detectInsightsOnSave } from '../db/insights.js'
import { detectBadgesOnSave } from '../db/badges.js'
import { syncNow } from '../db/sync.js'
import { getCache, setCache, clearCache } from '../lib/cache.js'
import { showToast, hideToast } from '../components/Toast.jsx'
import { exerciseMetric, isCountMetric, fmtMetricValue } from '../lib/metric.js'
import { buildRecommendation, defaultSet, sk } from '../lib/progressionCard.js'
import { WEIGHT_MAX, repsMax } from '../lib/setLimits.js'
import { exportWorkouts } from '../lib/exportWorkout.js'
import { templateExercisesFromWorkout, defaultTemplateName } from '../lib/templateFromWorkout.js'
import { vibrate, HAPTIC } from '../lib/haptics.js'
import CardsSkeleton from '../components/CardsSkeleton.jsx'
import ExercisePicker from '../components/ExercisePicker.jsx'
import TemplatePicker from '../components/TemplatePicker.jsx'
import ExerciseCard from '../components/ExerciseCard.jsx'

// локальный документ → редактируемая форма [{ exercise, sets:[{weight,reps}] }].
// sk() — стабильный ключ строки подхода для React (единый модульный счётчик в
// lib/progressionCard.js). defaultSet/buildRecommendation оттуда же.
function toEntries(workout) {
  return (workout?.entries ?? []).map((e) => ({
    exercise: e.exercise ?? { id: e.exercise_id, name: '—' },
    sets: (e.sets ?? []).map((s) => ({ weight: s.weight, reps: s.reps, _k: sk() })),
  }))
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ISO-дату (performed_at) → YYYY-MM-DD для <input type=date> и обратно.
function toDateInput(iso) {
  const d = iso ? new Date(iso) : new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d - off).toISOString().slice(0, 10)
}
function fromDateInput(value, prevIso) {
  // сохраняем время суток из исходной даты (или текущее), меняем только день
  const base = prevIso ? new Date(prevIso) : new Date()
  const [y, m, d] = value.split('-').map(Number)
  base.setFullYear(y, m - 1, d)
  return base.toISOString()
}

// Экран-композер (новая тренировка) и экран-деталь (правка существующей).
//   workoutId == null → новая (черновик в кэше переживает уход с экрана)
//   workoutId != null → существующая (читаем из документа, кэш не трогаем)
export default function WorkoutScreen({ user, workoutId = null, onBack }) {
  const isNew = workoutId == null
  // Справочник — из локальной базы (офлайн-доступен).
  const exercises = useLiveQuery(() => getExercises(), [], [])
  // Настройки автопрогрессии (глобальный тумблер + пер-упражнение). Дефолт до
  // загрузки — включено (как и первый резолв в repo.getProgSettings).
  const prog = useLiveQuery(() => getProgSettings(user.id), [user.id], { enabled: true, byExercise: {} })

  // Черновик в памяти — только для новой тренировки (ключ привязан к пользователю).
  const DRAFT_KEY = `workout_draft_new_${user.id}`

  const [entries, setEntries] = useState(() => (isNew ? getCache(DRAFT_KEY) ?? [] : []))
  const [performedAt, setPerformedAt] = useState(() => new Date().toISOString())
  const [loading, setLoading] = useState(!isNew)
  const [pickerOpen, setPickerOpen] = useState(false)
  // null → пикер в режиме «добавить»; число → индекс entry, который заменяем.
  const [replaceIdx, setReplaceIdx] = useState(null)
  const [tplPickerOpen, setTplPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null) // {type, text}
  const [delArm, setDelArm] = useState(false)   // in-app подтверждение удаления (как везде)
  const [clearArm, setClearArm] = useState(false) // подтверждение отказа от черновика новой
  // «Сделать шаблон из тренировки»: раскрытая форма с именем + занятость.
  const [tplArm, setTplArm] = useState(false)
  const [tplName, setTplName] = useState('')
  const [tplBusy, setTplBusy] = useState(false)

  // Сохраняем черновик новой тренировки при каждом изменении состава.
  useEffect(() => {
    if (isNew) setCache(DRAFT_KEY, entries)
  }, [isNew, DRAFT_KEY, entries])

  // Undo-тост удаления привязан к ЭТОМУ экрану: его «Отменить» зовёт setEntries,
  // которого после ухода со страницы уже нет. Поэтому при размонтировании гасим
  // только его (kind:'undo') — смена вкладки/возврат к списку убирают зависший
  // тост. Поздравление о рекорде/цели (без kind) переживает onBack, как раньше.
  useEffect(() => () => hideToast('undo'), [])

  // Загрузка существующей тренировки на маунте (документ — источник правды).
  useEffect(() => {
    if (isNew) return
    let alive = true
    setLoading(true)
    getWorkout(workoutId).then((w) => {
      if (!alive) return
      if (w) {
        setEntries(toEntries(w))
        setPerformedAt(w.performed_at ?? new Date().toISOString())
      } else {
        setMessage({ type: 'error', text: 'Тренировка не найдена.' })
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [isNew, workoutId])

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
    setPickerOpen(false)
    if (entries.some((e) => e.exercise.id === ex.id)) {
      setMessage({ type: 'error', text: 'Это упражнение уже добавлено.' })
      return
    }
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
    // Пока читали историю, состав мог измениться (двойной тап/undo) — анти-дубль
    // на свежем состоянии внутри апдейтера.
    setEntries((prev) =>
      prev.some((e) => e.exercise.id === ex.id) ? prev : [...prev, { exercise: ex, sets: built.sets, prog: built.meta }]
    )
  }

  // Откат к чистой копии прошлой сессии (ссылка «вернуть как в прошлый раз»).
  function revertProg(ei) {
    setEntries((prev) => prev.map((e, i) => {
      if (i !== ei || !e.prog) return e
      return {
        ...e,
        sets: e.prog.prev.map((s) => ({ ...s, _k: sk() })),
        prog: { ...e.prog, applied: false },
      }
    }))
  }

  // Повторно накатить рекомендацию после отката/ручной правки («Применить»).
  function applyProg(ei) {
    setEntries((prev) => prev.map((e, i) => {
      if (i !== ei || !e.prog) return e
      return {
        ...e,
        sets: e.prog.recSets.map((s) => ({ ...s, _k: sk() })),
        prog: { ...e.prog, applied: true },
      }
    }))
  }

  // Показать/спрятать настройки прогрессии (шестерёнка) в карточке.
  function toggleProgSettings(ei) {
    setEntries((prev) => prev.map((e, i) =>
      i === ei && e.prog ? { ...e, prog: { ...e.prog, settingsOpen: !e.prog.settingsOpen } } : e
    ))
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
      const wasApplied = e.prog?.applied !== false
      if (!built.meta) {
        // нет панели (активная стратегия без истории / глобально выкл) — убираем;
        // применявшим рекомендацию возвращаем копию прошлого, ручную правку не трогаем.
        return { ...e, prog: null, sets: wasApplied ? built.sets : e.sets }
      }
      // Держим шестерёнку открытой после переключения (в т.ч. на ручной/выкл —
      // строка-заглушка остаётся, стратегию можно вернуть). Для полной рекомендации
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
      setMessage({ type: 'error', text: 'Это упражнение уже добавлено.' })
      return
    }
    const count = isCountMetric(exerciseMetric(ex))
    setEntries((prev) => prev.map((e, i) => {
      if (i !== idx) return e
      const sets = count ? e.sets.map((s) => ({ ...s, weight: 0 })) : e.sets
      return { exercise: ex, sets }
    }))
  }

  function removeExercise(idx) {
    const removed = entries[idx]
    setEntries((prev) => prev.filter((_, i) => i !== idx))
    if (!removed) return
    // Удаление срабатывает сразу, но даём окно отмены — кнопка удаления
    // соседствует с зоной сохранения/добавления, легко нажать случайно.
    showToast({
      emoji: '🗑',
      kind: 'undo', // привязан к экрану — гасится при размонтировании WorkoutScreen
      title: 'Упражнение убрано',
      sub: removed.exercise?.name,
      actionLabel: 'Отменить',
      duration: 6000,
      raised: true, // выше липкой кнопки «Сохранить» — чтобы не перекрывала её
      onAction: () => setEntries((prev) => {
        // Анти-дубль: если упражнение успели вернуть/добавить — не плодим копию.
        if (prev.some((e) => e.exercise.id === removed.exercise.id)) return prev
        const next = prev.slice()
        next.splice(Math.min(idx, next.length), 0, removed)
        return next
      }),
    })
  }

  // Подходы из целевого плана упражнения шаблона: sets подходов по reps повторов
  // (× weight у весовых). Нет плана (легаси-шаблон) → один дефолтный подход.
  function setsFromTemplate(ex, item) {
    const n = Math.max(1, Math.round(Number(item?.sets)) || 0)
    if (!item?.sets) return [defaultSet(ex)]
    const count = isCountMetric(exerciseMetric(ex))
    const reps = Math.max(1, Math.round(Number(item.reps)) || defaultSet(ex).reps)
    const weight = count ? 0 : (Number(item.weight) || 0)
    return Array.from({ length: n }, () => ({ weight, reps, _k: sk() }))
  }

  // Применение шаблона (только новая тренировка): добавляем упражнения шаблона,
  // которых ещё нет (анти-дубль по exercise.id), каждому — подходы по целевому
  // плану шаблона (подходы × повторы × вес), либо один дефолтный, если плана нет.
  // Рекомендацию автопрогрессии показываем СПРАВОЧНО (applied:false): план шаблона
  // в подходах остаётся, панель лишь подсказывает «прошлая → рекомендуем сегодня»
  // с кнопкой «Применить рекомендацию» (перебивает план шаблона по желанию).
  async function applyTemplate(tpl) {
    setTplPickerOpen(false)
    const have = new Set(entries.map((e) => e.exercise.id))
    const items = (tpl.exercises ?? [])
      .filter((item) => (item.exercise?.id ?? item.exercise_id) && !have.has(item.exercise?.id ?? item.exercise_id))
    if (items.length === 0) {
      setMessage({ type: 'error', text: 'Все упражнения шаблона уже добавлены.' })
      return
    }
    const toAdd = []
    for (const item of items) {
      const ex = item.exercise ?? { id: item.exercise_id, name: '—' }
      const sets = setsFromTemplate(ex, item)
      // Рекомендация справочно: план шаблона в sets не подменяем, панель — не
      // применённая (applied:false). Нет истории/выключено → панели нет (meta:null).
      let meta = null
      try {
        const sessions = await getRecentSessionsForExercise(user.id, ex.id, 5)
        const built = buildRecommendation(ex, sessions, prog)
        meta = built.meta ? { ...built.meta, applied: built.meta.muted ? undefined : false } : null
      } catch { /* рекомендация необязательна */ }
      toAdd.push({ exercise: ex, sets, prog: meta })
    }
    // Пока читали историю, состав мог измениться — анти-дубль на свежем состоянии.
    setEntries((prev) => {
      const cur = new Set(prev.map((e) => e.exercise.id))
      const fresh = toAdd.filter((e) => !cur.has(e.exercise.id))
      return fresh.length ? [...prev, ...fresh] : prev
    })
  }

  function updateSet(ei, si, field, value) {
    setEntries((prev) => prev.map((e, i) => {
      if (i !== ei) return e
      const sets = e.sets.map((s, j) => (j === si ? { ...s, [field]: value } : s))
      return { ...e, sets }
    }))
  }

  function step(ei, si, field, delta) {
    const min = field === 'reps' ? 1 : 0
    setEntries((prev) => prev.map((e, i) => {
      if (i !== ei) return e
      // Верхняя граница степпера (та же, что клампит сохранение): вес → WEIGHT_MAX,
      // повторы/секунды → по метрике упражнения (у time там секунды).
      const max = field === 'weight' ? WEIGHT_MAX : repsMax(exerciseMetric(e.exercise))
      // Значение в state — строка из инпута: '', '.', '1.2.3' дают NaN. В этом
      // случае стартуем степпер от минимума, иначе в поле попадал бы «NaN».
      const base = Number(e.sets[si]?.[field])
      const cur = Number.isFinite(base) ? base : min
      const next = Math.min(max, Math.max(min, Math.round((cur + delta) * 100) / 100))
      const sets = e.sets.map((s, j) => (j === si ? { ...s, [field]: next } : s))
      return { ...e, sets }
    }))
  }

  function addSet(ei) {
    setEntries((prev) => prev.map((e, i) => {
      if (i !== ei) return e
      const last = e.sets[e.sets.length - 1] ?? defaultSet(e.exercise)
      return { ...e, sets: [...e.sets, { ...last, _k: sk() }] }
    }))
  }

  function removeSet(ei, si) {
    const entry = entries[ei]
    const removed = entry?.sets[si]
    setEntries((prev) => prev.map((e, i) =>
      i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e
    ))
    if (!removed) return
    const exId = entry.exercise.id
    // Точечная отмена: ищем упражнение по id (индекс мог сдвинуться) и
    // возвращаем подход на прежнее место.
    showToast({
      emoji: '🗑',
      kind: 'undo', // привязан к экрану — гасится при размонтировании WorkoutScreen
      title: 'Подход удалён',
      sub: entry.exercise?.name,
      actionLabel: 'Отменить',
      duration: 6000,
      raised: true, // выше липкой кнопки «Сохранить» — чтобы не перекрывала её
      onAction: () => setEntries((prev) => prev.map((e) => {
        if (e.exercise.id !== exId) return e
        const sets = e.sets.slice()
        sets.splice(Math.min(si, sets.length), 0, removed)
        return { ...e, sets }
      })),
    })
  }

  const totalSets = entries.reduce((n, e) => n + e.sets.length, 0)
  const canSave = entries.length > 0 && totalSets > 0 && !saving

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const wId = await saveWorkout({
        id: isNew ? undefined : workoutId,
        user_id: user.id,
        performed_at: performedAt,
        entries,
      })
      if (isNew) clearCache(DRAFT_KEY)
      // Тактильный отклик по итогу сохранения: рекорд/цель — «праздничный»
      // паттерн, обычное сохранение — короткий success (см. lib/haptics.js).
      let celebrated = false
      // Поздравление с новым личным рекордом (ТЗ §4.5). Только для новой
      // тренировки — чтобы повторная правка старой записи не поднимала ложный
      // рекорд. Рекорды считаются из локальных данных, сеть не нужна.
      if (isNew) {
        try {
          let congratulated = false
          const prs = await detectNewPrsOnSave(user.id, wId)
          if (prs.length) {
            const top = prs.reduce((a, b) => (b.value > a.value ? b : a), prs[0])
            const extra = prs.length > 1 ? ` +${prs.length - 1}` : ''
            showToast({
              title: 'Новый рекорд!',
              sub: `${top.name} — ${fmtMetricValue(top.metric, top.value)} (было ${fmtMetricValue(top.metric, top.prev)})${extra}`,
            })
            congratulated = true
          }
          // Достижение личной цели (ЛК). Поздравляем один раз; если совпало с
          // рекордом — поздравление о цели перекрывает тост рекорда (важнее).
          const reached = await detectGoalReachedOnSave(user.id, wId)
          if (reached.length) {
            const top = reached.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a), reached[0])
            const extra = reached.length > 1 ? ` +${reached.length - 1}` : ''
            // Повторы при целевом весе (PLAN-goal-reps) — показываем «× N», как в карточке цели.
            const repsStr = top.metric === 'weight' && Number(top.reps) > 0 ? ` × ${Math.round(Number(top.reps))}` : ''
            showToast({
              emoji: '🎯',
              title: reached.length > 1 ? 'Цели достигнуты!' : 'Цель достигнута!',
              sub: `${top.name} — ${fmtMetricValue(top.metric, top.value)}${repsStr}${extra}`,
            })
            congratulated = true
          }
          // Достижения/бейджи (PLAN-badges): detectBadgesOnSave ВСЕГДА штампует
          // новые вехи в meta (для экрана и колокольчика), но тост показываем
          // только если рекорд/цель не перекрыли — и не спамим (один тост «+N»).
          const newBadges = await detectBadgesOnSave(user.id)
          if (!congratulated && newBadges.length) {
            const extra = newBadges.length > 1 ? ` +${newBadges.length - 1}` : ''
            showToast({
              emoji: '🏆',
              title: newBadges.length > 1 ? 'Новые достижения!' : 'Новое достижение!',
              sub: `${newBadges[0].icon} ${newBadges[0].name}${extra}`,
            })
            congratulated = true
          }
          // Инсайт после тренировки (виш BACKLOG «Инсайты»): если рекорд/цель не
          // сработали, тихая сессия всё равно получает вывод (объём/серия/забытая
          // группа/тренд/обгон). Полный набор из 2–3 выводов — на Главной и в
          // Уведомлениях; тост показывает самый важный.
          if (!congratulated) {
            const ins = await detectInsightsOnSave(user.id, wId, { max: 1 })
            if (ins.length) {
              showToast({ emoji: ins[0].emoji, title: 'Вывод после тренировки', sub: ins[0].text })
            }
          }
          celebrated = congratulated
        } catch { /* тост необязателен */ }
      }
      vibrate(celebrated ? HAPTIC.celebrate : HAPTIC.success)
      if (navigator.onLine) syncNow(user.id)
      onBack?.()
    } catch (err) {
      setMessage({ type: 'error', text: 'Не сохранилось: ' + (err.message ?? err) })
      setSaving(false)
    }
  }

  // Отказ от новой тренировки. Экран «Назад» намеренно СОХРАНЯЕТ черновик в кэше
  // (случайный уход не теряет набранный состав — в т.ч. упражнения из шаблона),
  // поэтому явный отказ вынесен в отдельную кнопку: чистим кэш + состав, но
  // ОСТАЁМСЯ на экране новой тренировки (пустой composer), а не уходим в список —
  // пользователь ждёт, что продолжит добавлять с чистого листа. Уйти — «← Назад».
  function clearDraft() {
    clearCache(DRAFT_KEY)
    setEntries([])
    setClearArm(false)
  }

  // Экспорт этой тренировки в JSON-файл (из текущего состава формы).
  function exportOne() {
    const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
    exportWorkouts(
      { id: workoutId, performed_at: performedAt, created_at: null, entries },
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
  // берём по лучшему подходу каждого упражнения (см. lib/templateFromWorkout.js).
  // Приватный шаблон (is_public:false) — как «Новый шаблон» в разделе «Шаблоны».
  async function makeTemplate() {
    setTplBusy(true)
    setMessage(null)
    try {
      const exercises = templateExercisesFromWorkout(entries)
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
        <button className="link-btn back-link" onClick={() => onBack?.()}>← Назад</button>
        <h2 className="screen-title detail-title">
          {isNew ? 'Новая тренировка' : fmtDate(performedAt)}
        </h2>
      </div>

      {message && (
        <div className={message.type === 'error' ? 'banner error' : 'banner ok'}>
          {message.text}
        </div>
      )}

      {loading ? (
        <CardsSkeleton cards={3} />
      ) : (
        <>
          <label className="date-field">
            <span className="muted">Дата</span>
            <span className="date-picker">
              <span className="date-picker__icon" aria-hidden="true">📅</span>
              <span className="date-picker__value">{fmtDate(performedAt)}</span>
              <span className="date-picker__chevron" aria-hidden="true">▾</span>
              <input
                type="date"
                value={toDateInput(performedAt)}
                onChange={(e) => setPerformedAt(fromDateInput(e.target.value, performedAt))}
              />
            </span>
          </label>

          {entries.length === 0 && (
            <p className="muted empty">Добавь упражнение, чтобы начать.</p>
          )}

          {entries.map((entry, ei) => (
            <ExerciseCard
              key={entry.exercise.id}
              entry={entry}
              ei={ei}
              prog={prog}
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
            />
          ))}

          {isNew && (
            <button className="btn outline full" onClick={() => setTplPickerOpen(true)}>
              📋 Выбрать шаблон
            </button>
          )}

          <button className="btn outline full" onClick={openAddPicker}>
            + Добавить упражнение
          </button>

          {isNew && entries.length > 0 && (
            clearArm ? (
              <div className="danger-confirm">
                <p className="danger-text">Очистить черновик? Добавленные упражнения будут удалены.</p>
                <div className="danger-actions">
                  <button className="btn ghost" onClick={() => setClearArm(false)} disabled={saving}>Отмена</button>
                  <button className="btn danger" onClick={clearDraft} disabled={saving}>Да, очистить</button>
                </div>
              </div>
            ) : (
              <button className="link-btn danger full-link" disabled={saving} onClick={() => setClearArm(true)}>
                Очистить черновик
              </button>
            )
          )}

          {!isNew && (
            <button className="link-btn full-link" disabled={saving} onClick={exportOne}>
              ⬇ Экспорт в JSON
            </button>
          )}

          {!isNew && (
            tplArm ? (
              <div className="tpl-from-wk">
                <label className="tpl-name-field">
                  <span className="muted">Название шаблона</span>
                  <input
                    className="search"
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder="Название шаблона"
                    autoFocus
                  />
                </label>
                <div className="danger-actions">
                  <button className="btn ghost" onClick={() => setTplArm(false)} disabled={tplBusy}>Отмена</button>
                  <button className="btn primary" onClick={makeTemplate} disabled={tplBusy || !tplName.trim()}>
                    {tplBusy ? 'Создаю…' : 'Создать шаблон'}
                  </button>
                </div>
              </div>
            ) : (
              <button className="link-btn full-link" disabled={saving} onClick={openTplArm}>
                📋 Сделать шаблон из тренировки
              </button>
            )
          )}

          {!isNew && (
            delArm ? (
              <div className="danger-confirm">
                <p className="danger-text">Удалить эту тренировку? Действие необратимо.</p>
                <div className="danger-actions">
                  <button className="btn ghost" onClick={() => setDelArm(false)} disabled={saving}>Отмена</button>
                  <button className="btn danger" onClick={remove} disabled={saving}>
                    {saving ? 'Удаляю…' : 'Да, удалить'}
                  </button>
                </div>
              </div>
            ) : (
              <button className="link-btn danger full-link" disabled={saving} onClick={() => setDelArm(true)}>
                Удалить тренировку
              </button>
            )
          )}

          {/* Место под липкий бар, чтобы последний элемент можно было проскроллить
              выше плавающей кнопки «Сохранить». */}
          <div className="wk-save-spacer" aria-hidden="true" />

          {/* Липкая кнопка «Сохранить»: при длинной тренировке не уезжает вниз,
              всегда над таббаром (fixed, как тост/бар шаблона). */}
          <div className="wk-save-bar">
            <button className="btn primary full save-btn" disabled={!canSave} onClick={save}>
              {saving ? 'Сохранение…' : `Сохранить${totalSets ? ` (${totalSets})` : ''}`}
            </button>
          </div>
        </>
      )}

      {pickerOpen && (
        <ExercisePicker
          exercises={exercises}
          title={replaceIdx != null ? 'Заменить упражнение' : 'Упражнение'}
          onPick={handlePick}
          onCreate={createExercise}
          onClose={closePicker}
        />
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
