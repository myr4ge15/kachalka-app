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
import { getWorkouts, getBadges, saveWorkout, progKey, getRpe, getFavorites, getAccentPref } from './repo.js'
import { updateSyncedMeta } from './userMeta.js'
import { readGoals, writeGoals } from './notifications.js'
import {
  downloadBackup, parseBackup, assertSameOwner, planImport,
  mergeBadgesForImport, mergeProgForImport, mergeFavsForImport, accentForImport,
} from '../lib/backup.js'
import { mergeRpe } from '../lib/rpe.js'

// Собрать все личное состояние и сразу скачать файлом.
export async function exportAllMyData(userId, appVersion = 'dev') {
  const [workouts, goals, badges, prog, rpe, fav, accent, priv] = await Promise.all([
    getWorkouts(userId),
    readGoals(userId),
    getBadges(userId),
    getMeta(progKey(userId)),
    getRpe(userId),
    getFavorites(userId),
    getAccentPref(userId),
    getMeta(`priv_${userId}`),
  ])
  downloadBackup({ userId, workouts, goals, badges, prog, rpe, fav, accent, priv }, appVersion)
  return workouts.length
}

// Восстановить из файла в режиме «только добавить недостающее».
// Кидает BackupError на чужом/битом файле. Возвращает counts для тоста.
export async function importAllMyData(userId, text) {
  const snapshot = parseBackup(text)
  assertSameOwner(snapshot, userId)

  // Справочник упражнений берем ЦЕЛИКОМ (включая is_hidden): в истории могут
  // лежать скрытые админкой упражнения, и для них полная форма тоже нужна.
  const [all, goals, badges, prog, rpe, fav, accent, exercises] = await Promise.all([
    db.workouts.toArray(),
    readGoals(userId),
    getBadges(userId),
    getMeta(progKey(userId)),
    getRpe(userId),
    getMeta(`fav_${userId}`),
    getAccentPref(userId),
    db.exercises.toArray(),
  ])

  const plan = planImport(snapshot, {
    // Занятыми считаем ВСЕ id, включая tombstone'ы: импорт не должен воскрешать
    // удаленную тренировку (иначе «удалил → восстановил бэкап» вернет ее молча).
    workoutIds: new Set(all.map((w) => w.id)),
    goals,
    badges,
    prog,
    rpe,
    fav,
    accent,
    userId,
    exercises: new Map(exercises.map((e) => [e.id, e])),
  })

  // Тренировки — по одной через repo (транзакция + outbox внутри). Единичный
  // сбой (напр. упражнение не прошло валидацию) не должен ронять весь импорт.
  let failed = 0
  for (const w of plan.workouts) {
    try {
      await saveWorkout({ id: w.id, user_id: userId, performed_at: w.performed_at, entries: w.entries })
    } catch {
      failed++
    }
  }
  if (plan.goals) await writeGoals(userId, plan.goals)
  // Синкаемые роды пишем ТОЛЬКО через синкаемую запись (dirty + свежая отметка):
  // иначе ближайший pullUserMeta по LWW отдал бы приоритет серверному значению
  // и восстановленное пропало бы, так и не доехав до сервера. Слияние с текущим
  // повторяем ВНУТРИ транзакции записи (updateSyncedMeta) по свежему значению:
  // план считан до долгого цикла saveWorkout, и за это время pull/экран могли
  // поменять meta — запись плана целиком перетерла бы их (РЕВЬЮ-КОДА-2026-10-02).
  const s = snapshot?.settings ?? {}
  if (plan.badges) await updateSyncedMeta(userId, 'badges', (cur) => mergeBadgesForImport(cur, snapshot?.badges) ?? cur)
  if (plan.prog) await updateSyncedMeta(userId, 'prog', (cur) => mergeProgForImport(cur, s.progression) ?? cur)
  if (plan.rpe) await updateSyncedMeta(userId, 'rpe', (cur) => mergeRpe(cur ?? {}, snapshot?.rpe ?? {}, true))
  if (plan.fav) await updateSyncedMeta(userId, 'fav', (cur) => mergeFavsForImport(cur, s.favorites) ?? cur)
  if (plan.accent) await updateSyncedMeta(userId, 'accent', (cur) => accentForImport(cur, s.accent, userId) ?? cur)

  return { ...plan.counts, workouts: plan.counts.workouts - failed, failed }
}
