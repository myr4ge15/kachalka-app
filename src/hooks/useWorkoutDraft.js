import { useEffect, useRef, useState } from 'react'
import { getWorkout, getWorkoutFeels } from '../db/repo.js'
import { readDraft, writeDraft, clearDraft as dropDraft } from '../lib/draftStore.js'
import { sk } from '../lib/progressionCard.js'

// Состав тренировки в форме и его черновик (вынесено из WorkoutScreen, аудит 14.10).
//
// Новая тренировка (workoutId == null): состав, оценки RPE и вручную выбранная дата
// живут в lib/draftStore (память + localStorage) — переживают уход с экрана, выгрузку
// PWA в фоне и перезагрузку на обновление посреди занятия.
//
// Время тренировки (v8.7.0) — момент ПЕРВОГО упражнения в пустом черновике (руками,
// шаблоном, сканером), а не открытия экрана и не сохранения: оно и идет в Ленту.
// Хранится в черновике (START_KEY), поэтому выгрузка PWA посреди зала его больше не
// сдвигает. Старше START_TTL_MS — не в счет: черновик, собранный с вечера и поднятый
// завтра, становится «сегодняшним». Пустой состав сбрасывает отметку; дата, выбранная
// руками (DATE_KEY), главнее.
//
// Существующая: документ — источник правды; несохраненные правки (РЕВЬЮ-КОДА-2026-10-02,
// п. 15) лежат в том же хранилище с привязкой к версии документа (`base` = updated_at):
// если тренировку за это время изменили (синк с другого устройства), старые правки
// поверх не накатываем. Совпали с документом — черновик правки стирается.
//
// Оценки RPE до сохранения жить негде: id новой тренировки рождается только внутри
// saveWorkout. Отметок «подход выполнен» с v6.1.0 нет — что в строках, то и записано.

// локальный документ → редактируемая форма [{ exercise, sets:[{weight,reps}] }].
// sk() — стабильный ключ строки подхода для React (единый модульный счетчик в
// lib/progressionCard.js).
export function toEntries(workout) {
  return (workout?.entries ?? []).map((e) => ({
    exercise: e.exercise ?? { id: e.exercise_id, name: '—' },
    sets: (e.sets ?? []).map((s) => ({ weight: s.weight, reps: s.reps, _k: sk() })),
  }))
}

// Отпечаток формы для сравнения с документом: id упражнений, подходы строками, дата, оценки.
function snapshotOf(entries, performedAt, feels) {
  return JSON.stringify({
    e: entries.map((x) => ({ id: x.exercise?.id, s: x.sets.map((s) => [String(s.weight), String(s.reps)]) })),
    p: performedAt,
    f: feels,
  })
}

const START_TTL_MS = 12 * 60 * 60 * 1000

// Отметка начала из черновика, если она еще годится (не старше 12 ч, не из будущего).
export function freshStart(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '')
  return Number.isFinite(t) && now - t <= START_TTL_MS && t <= now + 60_000 ? iso : null
}

export function useWorkoutDraft({ userId, workoutId = null, onLoadError }) {
  const isNew = workoutId == null
  const DRAFT_KEY = `workout_draft_new_${userId}`
  const FEEL_KEY = `workout_feel_new_${userId}`
  const DATE_KEY = `workout_date_new_${userId}`
  const START_KEY = `workout_start_new_${userId}`
  const EDIT_KEY = isNew ? null : `workout_edit_${userId}_${workoutId}`

  const [entries, setEntries] = useState(() => (isNew ? readDraft(DRAFT_KEY) ?? [] : []))
  // { [exerciseId]: 'easy'|'ok'|'hard' } — только за эту тренировку.
  const [feels, setFeels] = useState(() => (isNew ? readDraft(FEEL_KEY) ?? {} : {}))
  const [performedAt, setPerformedAtState] = useState(
    () => (isNew && (readDraft(DATE_KEY) || freshStart(readDraft(START_KEY)))) || new Date().toISOString()
  )
  const [loading, setLoading] = useState(!isNew)
  const [editRestored, setEditRestored] = useState(false)
  const editBaseRef = useRef(null) // updated_at открытого документа
  const editOrigRef = useRef(null) // { entries, performedAt, feels } как в базе
  const loadErrorRef = useRef(onLoadError)
  useEffect(() => { loadErrorRef.current = onLoadError })

  // Дата выбрана руками — у новой она тоже часть черновика.
  function setPerformedAt(iso) {
    setPerformedAtState(iso)
    if (isNew) writeDraft(DATE_KEY, iso)
  }

  useEffect(() => {
    if (isNew) writeDraft(DRAFT_KEY, entries)
  }, [isNew, DRAFT_KEY, entries])

  useEffect(() => {
    if (isNew) writeDraft(FEEL_KEY, feels)
  }, [isNew, FEEL_KEY, feels])

  // Отметка начала: появилось первое упражнение — «сейчас»; состав опустел — сброс.
  const hasEntries = entries.length > 0
  useEffect(() => {
    if (!isNew) return
    if (!hasEntries) { dropDraft(START_KEY); return }
    if (readDraft(DATE_KEY) || freshStart(readDraft(START_KEY))) return
    const now = new Date().toISOString()
    writeDraft(START_KEY, now)
    setPerformedAtState(now)
  }, [isNew, hasEntries, START_KEY, DATE_KEY])

  useEffect(() => {
    if (isNew || loading || !editOrigRef.current) return
    const o = editOrigRef.current
    if (snapshotOf(entries, performedAt, feels) === snapshotOf(o.entries, o.performedAt, o.feels)) {
      dropDraft(EDIT_KEY)
    } else {
      writeDraft(EDIT_KEY, { base: editBaseRef.current, entries, performedAt, feels })
    }
  }, [isNew, loading, EDIT_KEY, entries, performedAt, feels])

  // Загрузка существующей тренировки на маунте (документ — источник правды).
  useEffect(() => {
    if (isNew) return undefined
    let alive = true
    setLoading(true)
    // Оценки лежат отдельной картой в meta (не в документе — см. lib/rpe.js),
    // поэтому при открытии на правку подтягиваем их своим чтением. Ошибка тут
    // не должна мешать правке: без оценок карточки просто откроются пустыми.
    Promise.all([
      getWorkout(workoutId),
      getWorkoutFeels(userId, workoutId).catch(() => ({})),
    ]).then(([w, f]) => {
      if (!alive) return
      if (w) {
        const loaded = toEntries(w)
        const at = w.performed_at ?? new Date().toISOString()
        const feelsLoaded = f ?? {}
        editBaseRef.current = w.updated_at ?? null
        editOrigRef.current = { entries: loaded, performedAt: at, feels: feelsLoaded }
        const draft = readDraft(EDIT_KEY)
        if (draft && draft.base === editBaseRef.current && Array.isArray(draft.entries)) {
          setEntries(draft.entries)
          setPerformedAtState(draft.performedAt ?? at)
          setFeels(draft.feels ?? feelsLoaded)
          setEditRestored(true)
        } else {
          if (draft) dropDraft(EDIT_KEY) // документ изменился — правки устарели
          setEntries(loaded)
          setPerformedAtState(at)
          setFeels(feelsLoaded)
        }
      } else {
        loadErrorRef.current?.('Тренировка не найдена.')
      }
      setLoading(false)
    }).catch((err) => {
      // Чтение из Dexie упало (напр. база закрыта при выходе) — не оставляем
      // экран в вечной «загрузке», показываем причину.
      if (!alive) return
      loadErrorRef.current?.('Не удалось открыть тренировку: ' + (err?.message ?? err))
      setLoading(false)
    })
    return () => { alive = false }
  }, [isNew, workoutId, userId, EDIT_KEY])

  // «Вернуть как было» — к документу, черновик правки стирается.
  function revertEdits() {
    const o = editOrigRef.current
    if (!o) return
    setEntries(o.entries)
    setPerformedAtState(o.performedAt)
    setFeels(o.feels)
    dropDraft(EDIT_KEY)
    setEditRestored(false)
  }

  // Отказ от новой тренировки: состав и оценки — с чистого листа, на экране остаемся.
  function clearDraft() {
    dropDraft(DRAFT_KEY)
    dropDraft(FEEL_KEY)
    dropDraft(DATE_KEY)
    dropDraft(START_KEY)
    setEntries([])
    setFeels({}) // и оценок: отказ от черновика отменяет занятие целиком
  }

  // Тренировка сохранена или удалена — черновик больше не нужен. Следующая новая
  // начинается без состава, оценок и даты.
  function dropSaved() {
    if (isNew) {
      dropDraft(DRAFT_KEY)
      dropDraft(FEEL_KEY)
      dropDraft(DATE_KEY)
      dropDraft(START_KEY)
    } else {
      dropDraft(EDIT_KEY)
    }
  }

  return {
    entries, setEntries, feels, setFeels, performedAt, setPerformedAt,
    loading, editRestored, revertEdits, clearDraft, dropSaved,
  }
}
