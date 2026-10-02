// ============================================================================
// Полный бэкап личных данных: «Скачать все мои данные» + «Восстановить из файла»
// (Профиль → Настройки). Чистые функции БЕЗ Dexie/React/сети — DB-обвязка живет
// в src/db/backup.js.
//
// ЗАЧЕМ. Часть пользовательских сущностей лежит ТОЛЬКО локально (см. AGENTS.md:
// badges_/prog_ в персональной meta) и теряется при смене устройства или чистке
// браузера. Файл-снимок закрывает этот класс страхов, не трогая схему Dexie и
// синхронизацию.
//
// ЧТО ВНУТРИ: тренировки (тем же чистильщиком, что и обычный экспорт истории —
// cleanWorkoutForExport), цели, бейджи, настройки автопрогрессии, оценки «как пошло»
// (RPE, lib/rpe.js), избранные упражнения и выбранный акцент (с v6.7.x — до этого
// новые роды fav/accent в файл не попадали, РЕВЬЮ-КОДА-2026-10-02) + флаг
// приватности (справочно). Старые файлы без этих полей импортируются как раньше. Шаблоны и упражнения — НЕ здесь: у шаблонов свой
// экспорт (exportTemplate.js), а упражнения общие для всех, их импорт плодил бы
// дубли на весь круг.
//
// СЕМАНТИКА ИМПОРТА — «только добавить недостающее» (см. planImport): ничего
// существующего не перезаписываем и не удаляем. Повторный импорт того же файла
// идемпотентен (дедуп по id тренировки / exerciseId цели / id бейджа).
//
// ФЛАГ ПРИВАТНОСТИ НЕ ВОССТАНАВЛИВАЕТСЯ: priv_${id} — зеркало серверного
// my_is_private, его переписывает ближайший pull. Кладем в файл только чтобы
// снимок был полным для глаз человека.
// ============================================================================
import { localYmd } from './calendar.js'
import { cleanWorkoutForExport, downloadJson } from './exportWorkout.js'
import { normMetric } from './metric.js'
import { mergeRpe } from './rpe.js'
import { normalizeFavs } from './favorites.js'
import { parseAccent } from './accent.js'

export const BACKUP_SCHEMA = 'full-backup/v1'

// Ошибка разбора файла с человекочитаемым текстом (показываем прямо в тосте).
export class BackupError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BackupError'
  }
}

// ------------------------------- сборка ------------------------------------

// Снимок для выгрузки. `data` — уже собранное состояние из Dexie:
//   { userId, userName, workouts, goals, badges, prog, rpe, fav, accent, priv }
export function buildBackup(data, appVersion = 'dev', now = new Date()) {
  const at = now instanceof Date ? now : new Date(now)
  const d = data ?? {}
  return {
    app: 'Журнал тренировок',
    schema: BACKUP_SCHEMA,
    app_version: appVersion,
    exported_at: Number.isNaN(at.getTime()) ? null : at.toISOString(),
    // Владелец снимка: импорт в ЧУЖУЮ учетку запрещен (см. assertSameOwner) —
    // id тренировок на сервере принадлежат автору, чужой upsert упрется в
    // проверку владельца и уедет в dead-letter.
    user: { id: d.userId ?? null, name: d.userName ?? null },
    counts: {
      workouts: (d.workouts ?? []).length,
      goals: (d.goals ?? []).filter((g) => !g?._deleted).length,
      badges: Object.keys(d.badges ?? {}).length,
    },
    workouts: (d.workouts ?? []).map(cleanWorkoutForExport),
    // Цели — без служебного _dirty (он про очередь отправки, не про данные).
    goals: (d.goals ?? [])
      .filter((g) => g && !g._deleted)
      .map((g) => ({
        exerciseId: g.exerciseId,
        exerciseName: g.exerciseName ?? '—',
        metric: normMetric(g.metric),
        targetWeight: g.targetWeight,
        targetReps: g.targetReps ?? null,
        achievedAt: g.achievedAt ?? null,
      })),
    badges: d.badges ?? {},
    // Оценки «как пошло»: { [workoutId]: { at, ex: { [exerciseId]: feel } } }.
    // Отдельной картой, как и в meta (в документе тренировки их нет, см. lib/rpe.js).
    rpe: d.rpe ?? {},
    settings: {
      progression: d.prog ?? null,
      // Избранные упражнения (род fav): массив id, свежие сверху.
      favorites: normalizeFavs(d.fav),
      // Выбранный акцент (род accent): { id, hue, by }. Только СВОЙ (by === владелец
      // снимка) — чужой/«ничей» цвет в файл не кладем (см. hooks/useAccentSync).
      accent: ownAccent(d.accent, d.userId),
      // Справочно, при импорте игнорируется (см. шапку файла).
      is_private: d.priv == null ? null : Boolean(d.priv),
    },
  }
}

function ownAccent(v, userId) {
  if (!v || typeof v !== 'object' || userId == null) return null
  if (String(v.by) !== String(userId)) return null
  return { id: v.id, hue: v.hue ?? null, by: String(userId) }
}

// YYYY-MM-DD из даты/ISO ('' если не распарсилось). Копия из exportWorkout.js —
// там она не экспортируется, а тянуть ради трех строк новый общий модуль дороже.
function ymd(d) {
  const t = d instanceof Date ? d : new Date(d)
  return localYmd(t) // местный день: ночью UTC-дата — еще «вчера»
}

// Имя файла бэкапа: backup-YYYY-MM-DD.json (дата выгрузки).
export function backupFilename(now = new Date()) {
  return `backup-${ymd(now) || 'export'}.json`
}

// Браузерная выгрузка снимка (переиспользует downloadJson из exportWorkout.js).
export function downloadBackup(data, appVersion = 'dev', now = new Date()) {
  downloadJson(buildBackup(data, appVersion, now), backupFilename(now))
}

// ------------------------------- разбор ------------------------------------

// Текст файла → снимок. Кидает BackupError с внятным текстом на любом мусоре:
// пользователь может выбрать не тот файл (экспорт одной тренировки, шаблоны,
// вообще не JSON), и молчаливое «ничего не произошло» тут хуже ошибки.
export function parseBackup(text) {
  let obj
  try {
    obj = JSON.parse(String(text ?? ''))
  } catch {
    throw new BackupError('Это не JSON-файл.')
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new BackupError('Файл не похож на выгрузку приложения.')
  }
  if (obj.schema !== BACKUP_SCHEMA) {
    // Частый промах: подсунули экспорт истории или шаблонов.
    const hint =
      obj.schema === 'workouts-export/v1'
        ? ' Это выгрузка тренировок, а не полный бэкап.'
        : obj.schema === 'templates-export/v1'
          ? ' Это выгрузка шаблонов, а не полный бэкап.'
          : ''
    throw new BackupError(`Нужен файл полного бэкапа.${hint}`)
  }
  return obj
}

// Проверка владельца: восстанавливаем только в СВОЮ учетку. Снимок без user.id
// (совсем старый/рукописный) пропускаем — сверять не с чем.
export function assertSameOwner(snapshot, userId) {
  const owner = snapshot?.user?.id ?? null
  if (owner && userId && String(owner) !== String(userId)) {
    throw new BackupError(
      `Файл принадлежит другому пользователю${snapshot.user.name ? ` (${snapshot.user.name})` : ''}.`
    )
  }
}

// ------------------------------- импорт ------------------------------------

// Достать упражнение по id из локального справочника. Принимает Map или обычный
// объект — чтобы вызывающему не навязывать форму.
function lookupExercise(exercises, id) {
  if (!exercises || id == null) return null
  if (typeof exercises.get === 'function') return exercises.get(id) ?? null
  return exercises[id] ?? null
}

// Одна запись снимка → запись для saveWorkout. Упражнение берем из ЛОКАЛЬНОГО
// справочника (там полная форма: submuscle/secondary/is_bench_lift), снимок —
// фолбэк для упражнений, которых на устройстве нет.
function importEntry(e, exercises) {
  const id = e?.exercise?.id ?? e?.exercise_id ?? null
  if (!id) return null
  const sets = (e?.sets ?? [])
    .map((s) => ({ weight: Number(s?.weight) || 0, reps: Number(s?.reps) || 0 }))
    // Пустой подход (0×0) роняет тренировку в «пустую» — отсеиваем здесь, чтобы
    // не потерять из-за него всю запись (клампинг значений сделает saveWorkout).
    .filter((s) => s.weight > 0 || s.reps > 0)
  if (sets.length === 0) return null
  const local = lookupExercise(exercises, id)
  return { exercise: local ?? { ...e.exercise, id }, sets }
}

// План импорта «только добавить недостающее». Ничего не перезаписывает.
//
// snapshot — результат parseBackup; current — текущее состояние:
//   { workoutIds: Set|Array, goals: [], badges: {}, prog: undefined|obj,
//     rpe: {}, fav: [], accent: obj|null, userId, exercises: Map|obj }
//
// Возвращает готовые к записи куски (null — «менять нечего») и счетчики для
// тоста. `workouts` идут в repo.saveWorkout КАК ЕСТЬ, с исходным id — поэтому
// повторный импорт того же файла ничего не добавит.
export function planImport(snapshot, current = {}) {
  const have = current.workoutIds instanceof Set
    ? current.workoutIds
    : new Set(current.workoutIds ?? [])

  // ── тренировки ───────────────────────────────────────────────────────────
  const workouts = []
  let workoutsSkipped = 0
  for (const w of snapshot?.workouts ?? []) {
    // Без id дедуп невозможен: повторный импорт плодил бы копии. Пропускаем.
    if (!w?.id) { workoutsSkipped++; continue }
    if (have.has(w.id)) continue // уже есть — НЕ трогаем (в т.ч. локально измененную)
    const entries = (w.entries ?? [])
      .map((e) => importEntry(e, current.exercises))
      .filter(Boolean)
    if (entries.length === 0) { workoutsSkipped++; continue }
    workouts.push({ id: w.id, performed_at: w.performed_at ?? null, entries })
  }

  // ── цели ─────────────────────────────────────────────────────────────────
  // Занятыми считаем и tombstone'ы (_deleted): импорт не должен воскрешать
  // цель, которую пользователь осознанно удалил.
  const curGoals = current.goals ?? []
  const goalKeys = new Set(curGoals.map((g) => String(g?.exerciseId)))
  const addGoals = (snapshot?.goals ?? [])
    .filter((g) => g?.exerciseId && !goalKeys.has(String(g.exerciseId)))
    .map((g) => ({
      exerciseId: g.exerciseId,
      exerciseName: g.exerciseName ?? '—',
      metric: normMetric(g.metric),
      targetWeight: g.targetWeight,
      targetReps: g.targetReps ?? null,
      achievedAt: g.achievedAt ?? null,
      // _dirty:1 — синк отправит восстановленную цель на сервер (ее увидит бот).
      _dirty: 1,
    }))

  // ── бейджи ───────────────────────────────────────────────────────────────
  const badges = mergeBadgesForImport(current.badges, snapshot?.badges)
  const badgesCount = badges ? Object.keys(badges).length - Object.keys(current.badges ?? {}).length : 0

  // ── настройки автопрогрессии ─────────────────────────────────────────────
  const prog = mergeProgForImport(current.prog, snapshot?.settings?.progression)

  // ── избранное и акцент (могут отсутствовать в старых файлах) ─────────────
  const fav = mergeFavsForImport(current.fav, snapshot?.settings?.favorites)
  const favCount = fav ? fav.length - normalizeFavs(current.fav).length : 0
  const accent = accentForImport(current.accent, snapshot?.settings?.accent, current.userId ?? snapshot?.user?.id)

  // ── оценки «как пошло» ───────────────────────────────────────────────────
  // Объединение с приоритетом ТЕКУЩИХ оценок (mergeRpe, preferLocal): добавляем
  // только пары (тренировка, упражнение), которых на устройстве еще нет.
  const curRpe = current.rpe ?? {}
  const mergedRpe = mergeRpe(curRpe, snapshot?.rpe ?? {}, true)
  const rpeCount = countFeels(mergedRpe) - countFeels(curRpe)
  const rpe = rpeCount > 0 ? mergedRpe : null

  return {
    workouts,
    goals: addGoals.length ? [...curGoals, ...addGoals] : null,
    badges,
    prog,
    rpe,
    fav,
    accent,
    counts: {
      workouts: workouts.length,
      workoutsSkipped,
      goals: addGoals.length,
      badges: badgesCount,
      prog: prog ? 1 : 0,
      rpe: Math.max(0, rpeCount),
      fav: Math.max(0, favCount),
      accent: accent ? 1 : 0,
    },
  }
}

// Слияния «только добавить недостающее» по отдельным родам. Экспортируются, чтобы
// DB-слой мог повторить слияние по СВЕЖЕМУ значению внутри транзакции записи
// (updateSyncedMeta), а не писать результат, посчитанный по снимку до await.
// null — менять нечего.

// Бейджи: добавляем только отсутствующие вехи.
export function mergeBadgesForImport(curBadges, snapBadges) {
  const cur = curBadges && typeof curBadges === 'object' ? curBadges : {}
  const add = {}
  for (const [id, rec] of Object.entries(snapBadges ?? {})) {
    if (!rec || typeof rec !== 'object' || !rec.at) continue
    if (cur[id]) continue
    // backfilled:true — восстановленная веха историческая: не должна всплывать
    // непрочитанным на колокольчике и праздничным тостом (см. db/badges.js).
    add[id] = { at: rec.at, backfilled: true }
  }
  return Object.keys(add).length ? { ...cur, ...add } : null
}

// Настройки автопрогрессии: добавляем упражнения, которых нет в текущих.
export function mergeProgForImport(curProg, snapProg) {
  if (!snapProg || typeof snapProg !== 'object') return null
  const cur = curProg && typeof curProg === 'object' ? curProg : null
  const byExercise = { ...(cur?.byExercise ?? {}) }
  let added = 0
  for (const [exId, cfg] of Object.entries(snapProg.byExercise ?? {})) {
    if (byExercise[exId] || !cfg || typeof cfg !== 'object') continue
    byExercise[exId] = cfg
    added++
  }
  // Глобальный тумблер восстанавливаем ТОЛЬКО если настроек еще не было
  // вообще — иначе перетерли бы текущий выбор пользователя.
  const enabled = cur ? cur.enabled !== false : snapProg.enabled !== false
  return added > 0 || !cur ? { enabled, byExercise } : null
}

// Избранное: текущий список остается как есть (порядок — выбор человека), из файла
// дописываются в конец только отсутствующие id (в пределах FAV_LIMIT).
export function mergeFavsForImport(curFav, snapFav) {
  const cur = normalizeFavs(curFav)
  const next = normalizeFavs([...cur, ...normalizeFavs(snapFav)])
  return next.length > cur.length ? next : null
}

// Акцент: восстанавливаем, только если своего выбора в учетке еще нет (не
// перетираем текущий) и значение в файле — свое (by === userId) или «ничье»
// (файл старой версии без by — тогда ставим by: userId, файл-то наш: владельца
// проверил assertSameOwner). Чужой by — пропускаем: useAccentSync его все равно
// не применит, а в учетке он был бы мусором.
export function accentForImport(curAccent, snapAccent, userId) {
  if (userId == null || !snapAccent || typeof snapAccent !== 'object') return null
  if (snapAccent.by != null && String(snapAccent.by) !== String(userId)) return null
  if (curAccent && typeof curAccent === 'object' && String(curAccent.by) === String(userId)) return null
  const p = parseAccent(JSON.stringify(snapAccent))
  return { id: p.id, hue: p.hue, by: String(userId) }
}

// Сколько оценок (пар тренировка × упражнение) в карте RPE.
function countFeels(map) {
  let n = 0
  // Надгробия снятых оценок (null, см. lib/rpe.js) оценками не считаем.
  for (const rec of Object.values(map ?? {})) {
    n += Object.values(rec?.ex ?? {}).filter((f) => f != null).length
  }
  return n
}

// Короткий человеческий итог импорта для тоста. Пусто → «все уже на месте».
export function describeImport(counts) {
  const c = counts ?? {}
  const parts = []
  if (c.workouts) parts.push(`тренировок: ${c.workouts}`)
  if (c.goals) parts.push(`целей: ${c.goals}`)
  if (c.badges) parts.push(`достижений: ${c.badges}`)
  if (c.rpe) parts.push(`оценок «как пошло»: ${c.rpe}`)
  if (c.fav) parts.push(`избранных упражнений: ${c.fav}`)
  if (c.prog) parts.push('настройки прогрессии')
  if (c.accent) parts.push('цвет оформления')
  if (parts.length === 0) return 'Все из файла уже было в приложении.'
  return `Добавлено — ${parts.join(', ')}.`
}
