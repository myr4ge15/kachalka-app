// ============================================================================
// Репозиторий данных — единственный API, которым пользуются экраны.
//
// Читает и пишет ТОЛЬКО в локальную базу (Dexie). Любая запись:
//   1) обновляет документ тренировки в `workouts` (UI меняется мгновенно);
//   2) ставит операцию в очередь `outbox` (несинхронизированные изменения).
// Сеть здесь не трогаем вообще — отправкой очереди занимается src/db/sync.js.
//
// Каноничный документ тренировки:
//   {
//     id, user_id, performed_at, updated_at,
//     _dirty, _deleted,
//     entries: [
//       { exercise_id, exercise: {id,name,muscle_group,is_bench_lift},
//         sets: [ { weight, reps } ] }
//     ]
//   }
// ============================================================================
import { db, newId, nowIso } from './local.js'
import { normalizeName } from '../lib/similar.js'
import { cmpIsoDesc } from '../lib/cmp.js'
import { sortUsersByOrder } from '../lib/userOrder.js'
import { normMetric } from '../lib/metric.js'

// ----------------------------- Чтение --------------------------------------

// Справочник упражнений для ПИКЕРА (из локального кэша). Скрытые админкой
// (is_hidden) сюда не попадают — их нельзя выбрать в новой тренировке/шаблоне,
// но уже записанные с ними тренировки в истории остаются (soft-hide).
export async function getExercises() {
  const list = await db.exercises.toArray()
  return list
    .filter((e) => !e.is_hidden)
    .sort(
      (a, b) =>
        String(a.muscle_group ?? '').localeCompare(String(b.muscle_group ?? '')) ||
        String(a.name ?? '').localeCompare(String(b.name ?? ''))
    )
}

// Полный справочник для АДМИНКИ — включая скрытые (помечаются в UI). Сортировка
// та же (группа, затем имя), чтобы список был предсказуем.
export async function getAllExercisesForAdmin() {
  const list = await db.exercises.toArray()
  return list.sort(
    (a, b) =>
      String(a.muscle_group ?? '').localeCompare(String(b.muscle_group ?? '')) ||
      String(a.name ?? '').localeCompare(String(b.name ?? ''))
  )
}

// Локально применить правку упражнения из админки (мгновенный UI до следующего
// pull). Мержим в существующую запись кэша. Сеть — в lib/admin.js.
export async function applyExerciseEditLocal(id, fields) {
  const ex = await db.exercises.get(id)
  if (!ex) return
  await db.exercises.put({ ...ex, ...fields })
}

// Локально применить слияние дублей: старое упражнение прячем (is_hidden=1).
// Денормализованные снимки в тренировках починятся на следующем pull.
export async function applyExerciseMergeLocal(fromId) {
  const ex = await db.exercises.get(fromId)
  if (ex) await db.exercises.put({ ...ex, is_hidden: true })
}

// Добавить пользовательское упражнение в общий справочник (ТЗ 3.2 / 4.4).
// Офлайн-first: пишем в локальный кэш (сразу видно в пикере) и ставим в очередь
// `ex_outbox` на отправку в Supabase. Возвращает объект упражнения для UI.
//
// Анти-дубль: если упражнение с тем же названием уже есть — НЕ плодим копию,
// возвращаем существующее. Сравнение по нормализованному ключу (ё/е, регистр,
// пунктуация, двойные пробелы), чтобы «Жим лёжа» и «жим  лежа» считались одним.
export async function createExercise({ name, muscle_group, metric }) {
  const clean = String(name ?? '').trim()
  if (!clean) throw new Error('Введите название упражнения.')
  const group = muscle_group ? String(muscle_group).trim() : null
  const mtr = normMetric(metric)

  const key = normalizeName(clean)
  const all = await db.exercises.toArray()
  const dup = all.find((e) => normalizeName(e.name) === key)
  if (dup) {
    return {
      id: dup.id,
      name: dup.name,
      muscle_group: dup.muscle_group ?? null,
      is_bench_lift: Boolean(dup.is_bench_lift),
      metric: normMetric(dup.metric),
      is_custom: Boolean(dup.is_custom),
    }
  }

  const id = newId()
  await db.transaction('rw', db.exercises, db.ex_outbox, async () => {
    await db.exercises.put({
      id,
      name: clean,
      muscle_group: group,
      is_custom: true,
      is_bench_lift: false,
      metric: mtr,
      unit: 'kg',
      _dirty: 1,
    })
    await db.ex_outbox.add({ exerciseId: id, createdAt: nowIso(), attempts: 0 })
  })

  return { id, name: clean, muscle_group: group, is_bench_lift: false, metric: mtr, is_custom: true }
}

// Пользователи (имена для пикера входа). Только {id,name} из login_users —
// pin_hash/pin_salt тут больше не хранятся (офлайн-сверка PIN идёт по
// отдельному кэшу своего хэша в meta, см. src/lib/auth.js).
export async function getUsers() {
  const list = await db.users.toArray()
  // Порядок входа: по sort_order (задаёт админ), учётки без порядка — в конец.
  return sortUsersByOrder(list)
}

// Сохранить список пользователей в кэш (вызывает экран входа, пока синк не запущен).
export async function cacheUsers(list) {
  if (!Array.isArray(list)) return
  await db.transaction('rw', db.users, async () => {
    await db.users.clear()
    await db.users.bulkPut(list)
  })
}

// Один пользователь из кэша (для аватара текущего пользователя в шапке/ЛК).
export async function getCachedUser(userId) {
  return db.users.get(userId)
}

// Локально проставить свой avatar_url сразу после загрузки (до следующего pull),
// чтобы шапка/ЛК обновились мгновенно. Мержим, чтобы не затереть name.
export async function setCachedAvatar(userId, url) {
  const u = await db.users.get(userId)
  await db.users.put({ ...(u ?? { id: userId }), avatar_url: url })
}

// Локально проставить своё имя сразу после смены (до следующего pull), чтобы
// пикер входа и кэш пользователей показывали новое имя. Мержим, чтобы не
// затереть avatar_url.
export async function setCachedName(userId, name) {
  const u = await db.users.get(userId)
  await db.users.put({ ...(u ?? { id: userId }), name })
}

// Тренировки пользователя (без удалённых), свежие сверху по ДАТЕ ТРЕНИРОВКИ.
// Сортируем по performed_at (дата самой тренировки), а не по моменту добавления:
// запись, внесённая задним числом, уходит на своё хронологическое место, а не
// всплывает наверх как новая. Тай-брейк для нескольких тренировок в один день —
// created_at (что внесли позже, то выше).
export async function getWorkouts(userId) {
  const list = await db.workouts.where('user_id').equals(userId).toArray()
  return list
    .filter((w) => !w._deleted)
    .sort((a, b) =>
      cmpIsoDesc(a.performed_at, b.performed_at) ||
      cmpIsoDesc(a.created_at, b.created_at)
    )
}

// Одиночная тренировка по id (для экрана-детали). null, если нет/удалена.
export async function getWorkout(id) {
  const w = await db.workouts.get(id)
  if (!w || w._deleted) return null
  return w
}

// Шаблоны, видимые пользователю: СВОИ (любые) + ЧУЖИЕ ОБЩИЕ (is_public).
// Чужой приватный шаблон не виден. Свежесозданные сверху (created_at, тай-брейк
// по имени). Шаблонов мало — читаем всё и фильтруем в памяти.
export async function getTemplates(userId) {
  const list = await db.templates.toArray()
  return list
    .filter((t) => !t._deleted && (t.user_id === userId || t.is_public))
    .sort(
      (a, b) =>
        cmpIsoDesc(a.created_at, b.created_at) ||
        String(a.name ?? '').localeCompare(String(b.name ?? ''))
    )
}

// Одиночный шаблон по id (для редактора). null, если нет/удалён.
export async function getTemplate(id) {
  const t = await db.templates.get(id)
  if (!t || t._deleted) return null
  return t
}

// ----------------------------- Запись --------------------------------------

// Парсим число из инпута, принимая десятичную запятую (1,5 → 1.5).
// Без этого Number('1,5') === NaN и подход молча отбрасывался.
function toNum(v) {
  if (typeof v === 'number') return v
  return Number(String(v ?? '').trim().replace(',', '.'))
}

// Нормализуем подходы из формы (строки из input) в числа.
function cleanEntries(entries) {
  return (entries ?? [])
    .map((e) => ({
      exercise_id: e.exercise?.id ?? e.exercise_id,
      exercise: e.exercise
        ? {
            id: e.exercise.id,
            name: e.exercise.name,
            muscle_group: e.exercise.muscle_group ?? null,
            is_bench_lift: Boolean(e.exercise.is_bench_lift),
            metric: normMetric(e.exercise.metric),
          }
        : undefined,
      sets: (e.sets ?? [])
        .map((s) => ({ weight: toNum(s.weight), reps: toNum(s.reps) }))
        .filter((s) => Number.isFinite(s.weight) && Number.isFinite(s.reps) && s.reps > 0),
    }))
    .filter((e) => e.exercise_id && e.sets.length > 0)
}

// Создать новую или переписать существующую тренировку.
// Возвращает id. Передай существующий id, чтобы отредактировать.
export async function saveWorkout({ id, user_id, performed_at, entries }) {
  const cleaned = cleanEntries(entries)
  if (cleaned.length === 0) throw new Error('Пустая тренировка: добавь хотя бы один подход.')

  const wId = id ?? newId()
  const now = nowIso()

  await db.transaction('rw', db.workouts, db.outbox, async () => {
    const existing = id ? await db.workouts.get(id) : null
    const doc = {
      id: wId,
      user_id,
      performed_at: performed_at ?? existing?.performed_at ?? now,
      // created_at: при создании = now; при правке сохраняем существующий.
      // Фолбэк на performed_at для записей, пришедших без него.
      created_at: existing?.created_at ?? now,
      updated_at: now,
      entries: cleaned,
      _dirty: 1,
      _deleted: 0,
    }
    await db.workouts.put(doc)
    await enqueue('upsert', wId)
  })

  return wId
}

// Удалить тренировку. Помечаем tombstone и ставим в очередь удаление.
export async function deleteWorkout(id) {
  await db.transaction('rw', db.workouts, db.outbox, async () => {
    const doc = await db.workouts.get(id)
    if (!doc) return
    await db.workouts.update(id, { _deleted: 1, _dirty: 0, updated_at: nowIso() })
    await enqueue('delete', id)
  })
}

// Soft-delete всех своих тренировок (ЛК 2c, «Удалить мои данные»). Каждую
// помечаем tombstone и ставим удаление в очередь — синк отправит на сервер тем
// же путём, что и одиночное удаление. Учётку, цели и шаблоны НЕ трогаем
// (восстановимо: на сервере записи стираются, но аккаунт и история на других
// устройствах до синка остаются). Возвращает число помеченных тренировок.
export async function softDeleteMyWorkouts(userId) {
  return db.transaction('rw', db.workouts, db.outbox, async () => {
    const mine = await db.workouts.where('user_id').equals(userId).toArray()
    let n = 0
    for (const w of mine) {
      if (w._deleted) continue // уже помечена — не плодим дубль в очереди
      await db.workouts.update(w.id, { _deleted: 1, _dirty: 0, updated_at: nowIso() })
      await enqueue('delete', w.id)
      n++
    }
    return n
  })
}

// ------------------------- Очередь (outbox) --------------------------------
// Схлопываем дубли по тренировке, чтобы очередь не разрасталась:
//  - upsert поверх upsert → одна операция (push всегда читает свежий документ);
//  - delete отменяет ожидающие upsert той же тренировки;
//  - upsert после delete (повторное создание) → заменяет delete на upsert.
async function enqueue(type, workoutId) {
  const pending = await db.outbox.where('workoutId').equals(workoutId).toArray()
  if (type === 'upsert') {
    if (pending.some((o) => o.type === 'upsert')) return
    // если был delete — снимаем его, ставим upsert
    for (const o of pending) if (o.type === 'delete') await db.outbox.delete(o.seq)
    await db.outbox.add({ workoutId, type, createdAt: nowIso(), attempts: 0 })
  } else {
    // delete: убираем все upsert этой тренировки
    for (const o of pending) if (o.type === 'upsert') await db.outbox.delete(o.seq)
    if (pending.some((o) => o.type === 'delete')) return
    await db.outbox.add({ workoutId, type, createdAt: nowIso(), attempts: 0 })
  }
}

// ------------------------- Шаблоны (запись) --------------------------------

// Нормализуем целевой план упражнения шаблона: подходы × повторы (× вес).
//   sets   — число подходов (≥1, дефолт 3);
//   reps   — повторы на подход (≥1, дефолт 10; для time — секунды);
//   weight — целевой вес, кг (≥0; у не-весовых = 0).
// Значения хранятся числами; на сервере — колонки target_sets/reps/weight.
function cleanTargets(e, metric) {
  const sets = Math.max(1, Math.round(toNum(e.sets)) || 3)
  const reps = Math.max(1, Math.round(toNum(e.reps)) || 10)
  const w = toNum(e.weight)
  const weight = metric === 'weight' && Number.isFinite(w) && w > 0 ? w : 0
  return { sets, reps, weight }
}

// Нормализуем список упражнений шаблона из формы → денормализованный вид
// (exercise_id + вложенный exercise + position = индекс + целевой план).
function cleanTemplateExercises(exercises) {
  return (exercises ?? [])
    .map((e, i) => {
      const metric = normMetric(e.exercise?.metric)
      return {
        exercise_id: e.exercise?.id ?? e.exercise_id,
        exercise: e.exercise
          ? {
              id: e.exercise.id,
              name: e.exercise.name,
              muscle_group: e.exercise.muscle_group ?? null,
              is_bench_lift: Boolean(e.exercise.is_bench_lift),
              metric,
            }
          : undefined,
        position: i,
        ...cleanTargets(e, metric),
      }
    })
    .filter((e) => e.exercise_id)
    .map((e, i) => ({ ...e, position: i })) // переиндексация после отсева
}

// Создать новый или переписать существующий шаблон. Возвращает id.
// Передай существующий id, чтобы отредактировать.
export async function saveTemplate({ id, user_id, name, exercises, is_public }) {
  const clean = String(name ?? '').trim()
  if (!clean) throw new Error('Введите название шаблона.')
  const cleaned = cleanTemplateExercises(exercises)
  if (cleaned.length === 0) throw new Error('Добавь хотя бы одно упражнение.')

  const tId = id ?? newId()
  const now = nowIso()

  await db.transaction('rw', db.templates, db.tpl_outbox, async () => {
    const existing = id ? await db.templates.get(id) : null
    const doc = {
      id: tId,
      user_id,
      name: clean,
      // Видимость храним как 0|1 (Dexie индексирует числа, не булевы).
      is_public: is_public ? 1 : 0,
      // created_at: при создании = now; при правке сохраняем существующий.
      created_at: existing?.created_at ?? now,
      updated_at: now,
      exercises: cleaned,
      _dirty: 1,
      _deleted: 0,
    }
    await db.templates.put(doc)
    await enqueueTpl('upsert', tId)
  })

  return tId
}

// Удалить шаблон. Помечаем tombstone и ставим в очередь удаление.
export async function deleteTemplate(id) {
  await db.transaction('rw', db.templates, db.tpl_outbox, async () => {
    const doc = await db.templates.get(id)
    if (!doc) return
    await db.templates.update(id, { _deleted: 1, _dirty: 0, updated_at: nowIso() })
    await enqueueTpl('delete', id)
  })
}

// Очередь шаблонов (tpl_outbox) — та же логика схлопывания дублей, что у
// enqueue (тренировки), но по полю templateId.
async function enqueueTpl(type, templateId) {
  const pending = await db.tpl_outbox.where('templateId').equals(templateId).toArray()
  if (type === 'upsert') {
    if (pending.some((o) => o.type === 'upsert')) return
    for (const o of pending) if (o.type === 'delete') await db.tpl_outbox.delete(o.seq)
    await db.tpl_outbox.add({ templateId, type, createdAt: nowIso(), attempts: 0 })
  } else {
    for (const o of pending) if (o.type === 'upsert') await db.tpl_outbox.delete(o.seq)
    if (pending.some((o) => o.type === 'delete')) return
    await db.tpl_outbox.add({ templateId, type, createdAt: nowIso(), attempts: 0 })
  }
}

// Сколько изменений ждут отправки (тренировки + упражнения + шаблоны).
// Отравленные операции (_dead) в счётчик не входят — они уже не отправляются.
export async function pendingCount() {
  const [w, e, t] = await Promise.all([
    db.outbox.filter((o) => !o._dead).count(),
    db.ex_outbox.filter((o) => !o._dead).count(),
    db.tpl_outbox.filter((o) => !o._dead).count(),
  ])
  return w + e + t
}
