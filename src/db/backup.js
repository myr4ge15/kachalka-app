// ============================================================================
// DB-обвязка полного бэкапа («Скачать все мои данные» / «Восстановить из файла»
// в Профиле). Чистая логика — в src/lib/backup.js, здесь только чтение Dexie и
// запись через уже существующие точки входа.
//
// ИНВАРИАНТ СОБЛЮДЁН: сеть не трогаем. Восстановленные тренировки пишутся через
// repo.saveWorkout — он же ставит upsert в `outbox`, и обычный синк отправит их
// на сервер тем же путём, что и ручную запись. Цели уходят на сервер по _dirty.
// ============================================================================
import { db, getMeta, setMeta } from './local.js'
import { getWorkouts, getBadges, writeBadges, saveWorkout, progKey } from './repo.js'
import { readGoals, writeGoals } from './notifications.js'
import { downloadBackup, parseBackup, assertSameOwner, planImport } from '../lib/backup.js'

// Собрать всё личное состояние и сразу скачать файлом.
export async function exportAllMyData(userId, appVersion = 'dev') {
  const [workouts, goals, badges, prog, priv] = await Promise.all([
    getWorkouts(userId),
    readGoals(userId),
    getBadges(userId),
    getMeta(progKey(userId)),
    getMeta(`priv_${userId}`),
  ])
  downloadBackup({ userId, workouts, goals, badges, prog, priv }, appVersion)
  return workouts.length
}

// Восстановить из файла в режиме «только добавить недостающее».
// Кидает BackupError на чужом/битом файле. Возвращает counts для тоста.
export async function importAllMyData(userId, text) {
  const snapshot = parseBackup(text)
  assertSameOwner(snapshot, userId)

  // Справочник упражнений берём ЦЕЛИКОМ (включая is_hidden): в истории могут
  // лежать скрытые админкой упражнения, и для них полная форма тоже нужна.
  const [all, goals, badges, prog, exercises] = await Promise.all([
    db.workouts.toArray(),
    readGoals(userId),
    getBadges(userId),
    getMeta(progKey(userId)),
    db.exercises.toArray(),
  ])

  const plan = planImport(snapshot, {
    // Занятыми считаем ВСЕ id, включая tombstone'ы: импорт не должен воскрешать
    // удалённую тренировку (иначе «удалил → восстановил бэкап» вернёт её молча).
    workoutIds: new Set(all.map((w) => w.id)),
    goals,
    badges,
    prog,
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
  if (plan.badges) await writeBadges(userId, plan.badges)
  if (plan.prog) await setMeta(progKey(userId), plan.prog)

  return { ...plan.counts, workouts: plan.counts.workouts - failed, failed }
}
