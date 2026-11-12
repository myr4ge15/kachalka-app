// ============================================================================
// DB-обвязка полного бэкапа («Скачать все мои данные» / «Восстановить из файла»
// в Профиле). Чистая логика — в src/lib/backup.js, здесь только чтение Dexie и
// запись через уже существующие точки входа.
//
// ИНВАРИАНТ СОБЛЮДЕН: сеть не трогаем. Восстановленные тренировки пишутся через
// repo.saveWorkout — он же ставит upsert в `outbox`, и обычный синк отправит их
// на сервер тем же путем, что и ручную запись. Цели уходят на сервер по _dirty.
// ============================================================================
import { db, getMeta } from './local.js'
import { createExercise, getTemplates, getWorkouts, getBadges, saveTemplate, saveWorkout, progKey, getRpe, getFavorites, getAccentPref } from './repo.js'
import { updateSyncedMeta } from './userMeta.js'
import { readGoals, writeGoals } from './notifications.js'
import {
  downloadBackup, parseBackup, assertSameOwner, planImport, backupCatalog,
  mergeBadgesForImport, mergeProgForImport, mergeFavsForImport, accentForImport, mergeBodyForImport,
} from '../lib/backup.js'
import { bodyKey } from './body.js'
import { mergeRpe } from '../lib/rpe.js'

// Собрать все личное состояние и сразу скачать файлом.
export async function exportAllMyData(userId, appVersion = 'dev') {
  const [workouts, goals, badges, prog, rpe, fav, accent, priv, body, templates, exercises] = await Promise.all([
    getWorkouts(userId),
    readGoals(userId),
    getBadges(userId),
    getMeta(progKey(userId)),
    getRpe(userId),
    getFavorites(userId),
    getAccentPref(userId),
    getMeta(`priv_${userId}`),
    getMeta(bodyKey(userId)),
    getTemplates(userId),
    db.exercises.filter((e) => e.is_custom && e.owner_id === userId && !e.is_hidden && !e.merged_into).toArray(),
  ])
  // null — закрыли лист «Поделиться», ничего не сохранив: тоста «Файл сохранен» не будет.
  const how = await downloadBackup({
    userId, workouts, goals, badges, prog, rpe, fav, accent, priv, body, exercises,
    templates: templates.filter((t) => t.user_id === userId),
  }, appVersion)
  return how === 'cancelled' ? null : workouts.length
}

// Восстановить из файла в режиме «только добавить недостающее».
// Кидает BackupError на чужом/битом файле. Возвращает counts для тоста.
export async function importAllMyData(userId, text) {
  const snapshot = parseBackup(text)
  assertSameOwner(snapshot, userId)
  const d = db
  if (d?.name !== `gym_app_${userId}`) throw new Error('Учетная запись сменилась. Открой настройки снова.')

  // Справочник упражнений берем ЦЕЛИКОМ (включая is_hidden): в истории могут
  // лежать скрытые админкой упражнения, и для них полная форма тоже нужна.
  const [workoutIds, goals, badges, prog, rpe, fav, accent, body, exercises, templateIds] = await Promise.all([
    d.workouts.toCollection().primaryKeys(),
    readGoals(userId),
    getBadges(userId),
    getMeta(progKey(userId)),
    getRpe(userId),
    getMeta(`fav_${userId}`),
    getAccentPref(userId),
    getMeta(bodyKey(userId)),
    d.exercises.toArray(),
    d.templates.toCollection().primaryKeys(),
  ])

  const exerciseMap = new Map(exercises.map((e) => [e.id, e]))
  const catalog = backupCatalog(snapshot, exerciseMap, templateIds)
  let restoredExercises = 0
  for (const exercise of catalog.personal) {
    const saved = await createExercise({ ...exercise, owner_id: userId }, { restoreId: exercise.id, d })
    if (saved) restoredExercises++
    exerciseMap.set(exercise.id, await d.exercises.get(exercise.id))
  }

  const plan = planImport(snapshot, {
    // Занятыми считаем ВСЕ id, включая tombstone'ы: импорт не должен воскрешать
    // удаленную тренировку (иначе «удалил → восстановил бэкап» вернет ее молча).
    workoutIds,
    goals,
    badges,
    prog,
    rpe,
    fav,
    accent,
    body,
    userId,
    exercises: exerciseMap,
  })

  // Тренировки — по одной через repo (транзакция + outbox внутри). Единичный
  // сбой (напр. упражнение не прошло валидацию) не должен ронять весь импорт.
  let failed = catalog.skipped + plan.counts.workoutsSkipped
  let restoredWorkouts = 0
  let restoredTemplates = 0
  for (const w of plan.workouts) {
    try {
      if (await saveWorkout({ ...w, user_id: userId }, { restore: true, d })) restoredWorkouts++
    } catch {
      failed++
    }
  }
  for (const t of catalog.templates) {
    try {
      if (await saveTemplate({ ...t, user_id: userId }, { restore: true, d })) restoredTemplates++
    } catch {
      failed++
    }
  }
  let restoredGoals = 0
  if (plan.goals) await d.transaction('rw', d.meta, async () => {
    const current = await readGoals(userId, d)
    const have = new Set(current.map((g) => String(g.exerciseId)))
    const missing = plan.goals.slice(goals.length).filter((g) => {
      const id = String(g.exerciseId)
      if (have.has(id)) return false
      have.add(id)
      return true
    })
    if (missing.length) await writeGoals(userId, [...current, ...missing], d)
    restoredGoals = missing.length
  })
  // Синкаемые роды пишем ТОЛЬКО через синкаемую запись (dirty + свежая отметка):
  // иначе ближайший pullUserMeta по LWW отдал бы приоритет серверному значению
  // и восстановленное пропало бы, так и не доехав до сервера. Слияние с текущим
  // повторяем ВНУТРИ транзакции записи (updateSyncedMeta) по свежему значению:
  // план считан до долгого цикла saveWorkout, и за это время pull/экран могли
  // поменять meta — запись плана целиком перетерла бы их (РЕВЬЮ-КОДА-2026-10-02).
  const s = snapshot?.settings ?? {}
  if (plan.badges) await updateSyncedMeta(userId, 'badges', (cur) => mergeBadgesForImport(cur, snapshot?.badges) ?? cur, d)
  if (plan.prog) await updateSyncedMeta(userId, 'prog', (cur) => mergeProgForImport(cur, s.progression) ?? cur, d)
  if (plan.rpe) await updateSyncedMeta(userId, 'rpe', (cur) => mergeRpe(cur ?? {}, snapshot?.rpe ?? {}, true), d)
  if (plan.fav) await updateSyncedMeta(userId, 'fav', (cur) => mergeFavsForImport(cur, s.favorites) ?? cur, d)
  if (plan.accent) await updateSyncedMeta(userId, 'accent', (cur) => accentForImport(cur, s.accent, userId) ?? cur, d)
  if (plan.body) await updateSyncedMeta(userId, 'body', (cur) => mergeBodyForImport(cur, s.body) ?? cur, d)

  return { ...plan.counts, workouts: restoredWorkouts, templates: restoredTemplates, exercises: restoredExercises, goals: restoredGoals, failed }
}
