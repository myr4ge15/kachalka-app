// ============================================================================
// «Вес и замеры» — DB-обвязка (PLAN-body-metrics.md). Чистые правила — lib/body.js.
//
// Документ лежит в персональной meta под body_${userId} и синкается родом `body`
// в user_meta. Любая пользовательская правка — только через updateSyncedMeta:
// чтение и запись в одной транзакции (две быстрые правки или pull посередине не
// перетрут друг друга) + пометка dirty (иначе ближайший pull по LWW отдал бы
// победу серверу). Сеть здесь не трогаем.
// ============================================================================
import { db, getMeta, newId } from './local.js'
import { updateSyncedMeta, metaKeyFor } from './userMeta.js'
import {
  normalizeBody, putEntry, deleteEntry, setBodyPrefs as withPrefs, clearBody,
} from '../lib/body.js'

export const bodyKey = (userId) => metaKeyFor('body', userId)

// Документ как есть (нормализованный; пустой, если записей не было).
export async function getBody(userId, d = db) {
  if (!d || !userId) return normalizeBody(null)
  return normalizeBody(await getMeta(bodyKey(userId), d))
}

// Записать или поправить запись. Без id — новая. Возвращает id записи
// (null — в записи нет ни веса, ни обхвата: писать нечего).
export async function saveBodyEntry(userId, entry, d = db) {
  const id = entry?.id || newId()
  let saved = false
  await updateSyncedMeta(userId, 'body', (cur) => {
    const next = putEntry(cur, { ...entry, id })
    saved = next !== cur
    return next
  }, d)
  return saved ? id : null
}

export async function deleteBodyEntry(userId, id, d = db) {
  await updateSyncedMeta(userId, 'body', (cur) => deleteEntry(cur, id), d)
}

// goal / fields / hide.
export async function setBodyPrefs(userId, patch, d = db) {
  await updateSyncedMeta(userId, 'body', (cur) => withPrefs(cur, patch), d)
}

// «Удалить мои данные»: записи — надгробиями, цель снята (lib/body.js clearBody).
export async function clearMyBody(userId, d = db) {
  await updateSyncedMeta(userId, 'body', (cur) => (cur == null ? cur : clearBody(cur)), d)
}
