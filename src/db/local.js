// ============================================================================
// Локальная база (IndexedDB через Dexie) — источник правды для UI.
//
// Идея офлайн-first: экраны читают/пишут ТОЛЬКО сюда и обновляются мгновенно.
// Отдельный движок синхронизации (src/db/sync.js) в фоне:
//   - тянет свежие данные с Supabase в эти таблицы (pull);
//   - отправляет несинхронизированные изменения из очереди `outbox` (push).
//
// ИЗОЛЯЦИЯ ПО ПОЛЬЗОВАТЕЛЮ (PLAN-user-isolation, MAJOR). Раньше база была ОДНА на
// браузер (`new Dexie('gym_app')`) и держала записи ВСЕХ входивших на устройство
// пользователей — на общих телефонах закрытого круга это дважды протекало между
// учётками (лента/лидерборд/уведомления). Теперь у каждого юзера СВОЯ физическая
// IndexedDB `gym_app_${userId}`: данные одного физически не видны другому.
//   - `db` — активный инстанс персональной базы (live binding): null до входа,
//     открывается в openUserDb(userId) при входе, переоткрывается при смене юзера.
//     Все потребители (repo/feed/leaderboard/notifications/sync) импортируют `db`
//     и читают его в момент вызова (ES-модульная живая привязка), поэтому swap
//     инстанса виден всем без перезахвата.
//   - `loginDb` — общая «загрузочная» база: список учёток для пикера входа
//     (`users`) и офлайн-кэш PIN-хэшей (`meta`, см. lib/auth.js). Её читает
//     LoginScreen ДО выбора пользователя, когда персональная база ещё не открыта.
//
// Тренировка хранится денормализованно — одним документом с вложенными
// упражнениями и подходами. Так UI (история, прогресс, правка) работает без
// JOIN-ов, а синк отправляет/принимает запись целиком.
// ============================================================================
import Dexie from 'dexie'
import { selectDirtyForMigration } from '../lib/migration.js'
import { createSerialQueue } from '../lib/serialQueue.js'

// Имя старой ОБЩЕЙ базы (до изоляции). С неё переносим несинхронизированные
// правки в персональные базы; см. migrateUserFromOldDb / migrateLoginZone.
const OLD_DB = 'gym_app'

// Объявление схемы персональной базы. Вынесено в функцию, чтобы одинаково
// применять и к свежим персональным базам, и к открытию старой `gym_app` при
// миграции. Индексируем поля, по которым фильтруем/сортируем; булевы флаги храним
// как 0/1 (Dexie не индексирует true/false) — это и есть «очередь несинхрон.».
function defineSchema(d) {
  d.version(1).stores({
    exercises: 'id, muscle_group, name',
    users: 'id, name',
    workouts: 'id, user_id, performed_at, _dirty, _deleted',
    outbox: '++seq, workoutId, type, createdAt',
    meta: 'key',
  })
  // v2: кэш общей ленты тренировок друзей (read-only снимок с сервера).
  d.version(2).stores({
    exercises: 'id, muscle_group, name',
    users: 'id, name',
    workouts: 'id, user_id, performed_at, _dirty, _deleted',
    outbox: '++seq, workoutId, type, createdAt',
    meta: 'key',
    feed: 'id, performed_at',
  })
  // v3: пользовательские упражнения (индекс _dirty + очередь ex_outbox).
  d.version(3).stores({
    exercises: 'id, muscle_group, name, _dirty',
    users: 'id, name',
    workouts: 'id, user_id, performed_at, _dirty, _deleted',
    outbox: '++seq, workoutId, type, createdAt',
    meta: 'key',
    feed: 'id, performed_at',
    ex_outbox: '++seq, exerciseId, createdAt',
  })
  // v4: кэш лидерборда по жиму лёжа.
  d.version(4).stores({
    exercises: 'id, muscle_group, name, _dirty',
    users: 'id, name',
    workouts: 'id, user_id, performed_at, _dirty, _deleted',
    outbox: '++seq, workoutId, type, createdAt',
    meta: 'key',
    feed: 'id, performed_at',
    ex_outbox: '++seq, exerciseId, createdAt',
    leaderboard: 'user_id, orm',
  })
  // v5: шаблоны тренировок + очередь tpl_outbox.
  d.version(5).stores({
    exercises: 'id, muscle_group, name, _dirty',
    users: 'id, name',
    workouts: 'id, user_id, performed_at, _dirty, _deleted',
    outbox: '++seq, workoutId, type, createdAt',
    meta: 'key',
    feed: 'id, performed_at',
    ex_outbox: '++seq, exerciseId, createdAt',
    leaderboard: 'user_id, orm',
    templates: 'id, user_id, _dirty, _deleted',
    tpl_outbox: '++seq, templateId, createdAt',
  })
  // v6: публичные/приватные шаблоны (индекс is_public).
  d.version(6).stores({
    exercises: 'id, muscle_group, name, _dirty',
    users: 'id, name',
    workouts: 'id, user_id, performed_at, _dirty, _deleted',
    outbox: '++seq, workoutId, type, createdAt',
    meta: 'key',
    feed: 'id, performed_at',
    ex_outbox: '++seq, exerciseId, createdAt',
    leaderboard: 'user_id, orm',
    templates: 'id, user_id, is_public, _dirty, _deleted',
    tpl_outbox: '++seq, templateId, createdAt',
  })
  // v7: очередь реакций в ленте (reaction_outbox). Аддитивно (новая таблица),
  // прочие сторы без изменений → апгрейд с v6 безболезненный. Сами реакции в
  // локальной базе НЕ храним отдельной таблицей — они лежат внутри элементов
  // кэша `feed` (как отметки рекордов), очередь нужна лишь для офлайн-отправки.
  d.version(7).stores({
    exercises: 'id, muscle_group, name, _dirty',
    users: 'id, name',
    workouts: 'id, user_id, performed_at, _dirty, _deleted',
    outbox: '++seq, workoutId, type, createdAt',
    meta: 'key',
    feed: 'id, performed_at',
    ex_outbox: '++seq, exerciseId, createdAt',
    leaderboard: 'user_id, orm',
    templates: 'id, user_id, is_public, _dirty, _deleted',
    tpl_outbox: '++seq, templateId, createdAt',
    reaction_outbox: '++seq, workoutId, createdAt',
  })
  // v8: связи «избранного круга» (connections.sql). Аддитивно (две новые таблицы),
  // прочие сторы без изменений → апгрейд с v7 безболезненный. `connections` — кэш
  // связей текущего пользователя (снимок my_connections, ключ по other_id);
  // `connection_outbox` — офлайн-очередь операций (request/accept/remove).
  d.version(8).stores({
    exercises: 'id, muscle_group, name, _dirty',
    users: 'id, name',
    workouts: 'id, user_id, performed_at, _dirty, _deleted',
    outbox: '++seq, workoutId, type, createdAt',
    meta: 'key',
    feed: 'id, performed_at',
    ex_outbox: '++seq, exerciseId, createdAt',
    leaderboard: 'user_id, orm',
    templates: 'id, user_id, is_public, _dirty, _deleted',
    tpl_outbox: '++seq, templateId, createdAt',
    reaction_outbox: '++seq, workoutId, createdAt',
    connections: 'other_id, status',
    connection_outbox: '++seq, otherId, createdAt',
  })
  return d
}

// ----------------------------- login-база ----------------------------------
// Общая «загрузочная» база: данные ОБЩИЕ для всех учёток устройства, нужны ДО
// выбора пользователя. Здесь живут только: список учёток для пикера входа
// (`users` — имена/аватары/sort_order/sex, общий ростер круга) и офлайн-кэш
// своих PIN-хэшей (`meta`, ключ pin_${id}, см. lib/auth.js). Всё остальное —
// персонально (см. openUserDb).
export const loginDb = new Dexie('gym_app_login')
loginDb.version(1).stores({ users: 'id, name', meta: 'key' })

// ----------------------- активная персональная база -------------------------
// Живая привязка: переоткрывается при входе/смене юзера. null до первого входа.
export let db = null
let currentUserId = null

// Мьютекс открытия/закрытия базы. openUserDb внутри держит долгую миграцию
// (migrateUserFromOldDb), а close/повторный open меняют общий `db`. Без
// сериализации быстрый выход-вход другой учёткой во время миграции пересекался:
// база закрывалась из-под работающей миграции, та писала в закрытый инстанс →
// несинхрон. правки терялись. Гоняем оба через одну цепочку → следующая
// операция ждёт полного завершения предыдущей (включая миграцию).
const dbQueue = createSerialQueue()

// Открыть (или вернуть уже открытую) персональную базу пользователя. Закрывает
// предыдущую при смене юзера и запускает одноразовую миграцию его несинхрон.
// правок со старой общей `gym_app`. Возвращает инстанс. Сериализовано (dbQueue).
export function openUserDb(userId) {
  return dbQueue(() => openUserDbUnsafe(userId))
}

async function openUserDbUnsafe(userId) {
  if (!userId) return db
  if (currentUserId === userId && db) return db
  if (db) { try { db.close() } catch { /* ignore */ } }
  currentUserId = userId
  db = defineSchema(new Dexie('gym_app_' + userId))
  await db.open()
  await migrateUserFromOldDb(userId, db)
  return db
}

// Закрыть текущую персональную базу (выход). Изоляция и без этого физическая
// (разные базы), поэтому закрытие best-effort; ошибки глотаем. Сериализовано
// (dbQueue): не закроет базу из-под ещё идущей миграции предыдущего входа.
export function closeUserDb() {
  return dbQueue(() => {
    if (db) { try { db.close() } catch { /* ignore */ } }
    db = null
    currentUserId = null
  })
}

// Текущее серверное (UTC) время в ISO. crypto.randomUUID доступен на https и localhost.
export const nowIso = () => new Date().toISOString()
export const newId = () =>
  (crypto?.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      }))

// ------------------------------- meta --------------------------------------
// Персональная meta (цели, notif_seen, флаг приватности, lastSyncAt, журнал
// конфликтов). Зовётся только когда юзер вошёл (db открыта). Гард на null —
// страховка от запоздалого syncNow уже после выхода.
export async function getMeta(key) {
  if (!db) return undefined
  const row = await db.meta.get(key)
  return row?.value
}
export async function setMeta(key, value) {
  if (!db) return
  await db.meta.put({ key, value })
}

// Login-meta (общая база). Нужна ДО входа: офлайн-кэш PIN-хэшей читается на
// экране входа, когда персональная база ещё не открыта (см. lib/auth.js).
export async function getLoginMeta(key) {
  const row = await loginDb.meta.get(key)
  return row?.value
}
export async function setLoginMeta(key, value) {
  await loginDb.meta.put({ key, value })
}

// ------------------------------ миграция ------------------------------------

// Одноразовый перенос несинхронизированных правок текущего юзера со старой общей
// `gym_app` в его персональную базу. Идемпотентен (флаг в login-meta), безопасен
// при отсутствии старой базы. Переносим ТОЛЬКО _dirty/_deleted тренировки + их
// операции очереди (чистые доедут pull'ом), а также личные цели/метки, если их
// ещё нет в новой базе. Старую базу НЕ удаляем: на общем устройстве у других
// учёток там могут лежать ЕЩЁ не перенесённые несинхрон. правки — удаление до их
// входа = потеря данных. Ничего из `gym_app` после миграции не читается.
async function migrateUserFromOldDb(userId, target) {
  const flag = 'migrated_user_' + userId
  try {
    if (await getLoginMeta(flag)) return
    if (!(await Dexie.exists(OLD_DB))) { await setLoginMeta(flag, true); return }
    const old = defineSchema(new Dexie(OLD_DB))
    await old.open()
    try {
      const [workouts, outbox, goal, seen, priv] = await Promise.all([
        old.workouts.where('user_id').equals(userId).toArray().catch(() => []),
        old.outbox.toArray().catch(() => []),
        old.meta.get('goal_' + userId).catch(() => null),
        old.meta.get('notif_seen_at_' + userId).catch(() => null),
        old.meta.get('priv_' + userId).catch(() => null),
      ])
      const picked = selectDirtyForMigration(workouts, outbox, userId)
      await target.transaction('rw', target.workouts, target.outbox, target.meta, async () => {
        // Тренировки: не затираем уже подтянутые pull'ом (свежее) — кладём только
        // отсутствующие. Идемпотентность: повторный запуск ничего не дублирует.
        for (const w of picked.workouts) {
          if (!(await target.workouts.get(w.id))) await target.workouts.put(w)
        }
        // Операции очереди: дедуп по (workoutId, type), seq назначит автоинкремент.
        for (const o of picked.outbox) {
          const dup = await target.outbox.where('workoutId').equals(o.workoutId).toArray()
          if (dup.some((x) => x.type === o.type)) continue
          const { seq, ...rest } = o
          await target.outbox.add(rest)
        }
        // Личные цели: переносим массив целиком, если в новой базе их ещё нет
        // (сохраняет несинхрон. _dirty-цель; чистые потом приведёт pullGoal).
        if (goal?.value != null && !(await target.meta.get('goal_' + userId))) {
          await target.meta.put({ key: 'goal_' + userId, value: goal.value })
        }
        if (seen?.value != null && !(await target.meta.get('notif_seen_at_' + userId))) {
          await target.meta.put({ key: 'notif_seen_at_' + userId, value: seen.value })
        }
        if (priv?.value != null && !(await target.meta.get('priv_' + userId))) {
          await target.meta.put({ key: 'priv_' + userId, value: priv.value })
        }
      })
    } finally {
      try { old.close() } catch { /* ignore */ }
    }
    await setLoginMeta(flag, true)
  } catch {
    // Не критично: при сбое флаг не ставим → повтор на следующем входе.
  }
}

// Одноразовый перенос «загрузочной зоны» со старой `gym_app`: ростер учёток (для
// офлайн-пикера) и офлайн-кэш PIN-хэшей (pin_*), чтобы офлайн-разблокировка
// пережила обновление. Идемпотентен (флаг в login-meta). Зовётся на старте/входе
// ДО чтения пикера. Кладём только при отсутствии в loginDb (не затираем свежее).
export async function migrateLoginZone() {
  const flag = 'login_zone_migrated'
  try {
    if (await getLoginMeta(flag)) return
    if (!(await Dexie.exists(OLD_DB))) { await setLoginMeta(flag, true); return }
    const old = defineSchema(new Dexie(OLD_DB))
    await old.open()
    try {
      const [users, metas] = await Promise.all([
        old.users.toArray().catch(() => []),
        old.meta.toArray().catch(() => []),
      ])
      await loginDb.transaction('rw', loginDb.users, loginDb.meta, async () => {
        if (users.length && !(await loginDb.users.count())) {
          await loginDb.users.bulkPut(users)
        }
        for (const m of metas) {
          if (typeof m.key === 'string' && m.key.startsWith('pin_')) {
            if (!(await loginDb.meta.get(m.key))) await loginDb.meta.put(m)
          }
        }
      })
    } finally {
      try { old.close() } catch { /* ignore */ }
    }
    await setLoginMeta(flag, true)
  } catch {
    // Не критично: онлайн-пикер всё равно подтянет ростер из login_users.
  }
}
