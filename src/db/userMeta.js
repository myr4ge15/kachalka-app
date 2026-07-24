// ============================================================================
// Синк локального `meta` — слой БД (без сети; сеть в sync/push.js и sync/pull.js).
//
// Значения как лежали, так и лежат в персональной Dexie-meta по прежним ключам
// (`badges_${userId}`, `prog_${userId}`, `notif_seen_at_${userId}`) — экраны
// читают их как раньше, схему Dexie (v7) не трогаем. Здесь добавляется лишь
// СОСТОЯНИЕ СИНКА: одна служебная запись meta
//   user_meta_state = { [kind]: { at: ISO, dirty: 0|1 } }
// где at — отметка времени последней правки (локальной или принятой серверной),
// dirty — «есть что отправить». Само состояние на сервер не едет.
//
// Правило: любая ПОЛЬЗОВАТЕЛЬСКАЯ запись синкаемого ключа идёт через
// writeSyncedMeta (ставит dirty), а приём с сервера — через acceptSyncedMeta
// (dirty не ставит, иначе получим вечный пинг-понг push↔pull).
// ============================================================================
import { db, getMeta, setMeta, nowIso } from './local.js'
import { SYNCED_KINDS, metaKeyFor } from '../lib/userMeta.js'

const STATE_KEY = 'user_meta_state'

export { SYNCED_KINDS, metaKeyFor }

// Состояние синка целиком. Отсутствующие роды дополняем нулями, чтобы
// потребители не разбирали undefined.
export async function getUserMetaState(d = db) {
  const v = await getMeta(STATE_KEY, d)
  const src = v && typeof v === 'object' ? v : {}
  const out = {}
  for (const kind of SYNCED_KINDS) {
    const st = src[kind]
    out[kind] = { at: st?.at ?? '', dirty: st?.dirty ? 1 : 0 }
  }
  return out
}

// Точечное обновление состояния одного рода (мержим поверх текущего, чтобы не
// затирать соседей при параллельных правках).
export async function setUserMetaState(kind, patch, d = db) {
  const cur = await getUserMetaState(d)
  await setMeta(STATE_KEY, { ...cur, [kind]: { ...cur[kind], ...patch } }, d)
}

// Прочитать синкаемое значение (сырое, как лежит в meta).
export async function readSyncedMeta(userId, kind, d = db) {
  return (await getMeta(metaKeyFor(kind, userId), d)) ?? null
}

// ПОЛЬЗОВАТЕЛЬСКАЯ запись: значение + пометка «отправить». Зовётся из repo.js
// (бейджи, настройки прогрессии) и notifications.js (метка «прочитано»).
export async function writeSyncedMeta(userId, kind, value, d = db) {
  await setMeta(metaKeyFor(kind, userId), value, d)
  await setUserMetaState(kind, { at: nowIso(), dirty: 1 }, d)
}

// Приём значения с сервера: пишем без пометки dirty. write=false — значение не
// изменилось, трогаем только отметку времени (лишняя запись meta дёргала бы
// useLiveQuery на всех экранах).
export async function acceptSyncedMeta(userId, kind, { value, write, dirty, at }, d = db) {
  if (write) await setMeta(metaKeyFor(kind, userId), value, d)
  await setUserMetaState(kind, { at: at ?? nowIso(), dirty: dirty ? 1 : 0 }, d)
}
