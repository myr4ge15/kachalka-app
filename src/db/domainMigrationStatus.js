// Сигнал устройства, как presence: без офлайн-очереди, данных тренировок не меняет.
import { supabase, hasSession } from './supabase.js'
import { checkDomainMigration, inspectDomainMigration } from './domainMigration.js'
import { db } from './local.js'
import { APP_VERSION, IS_BETA } from '../lib/appVersion.js'
import { migrationDomain, MIGRATION_STATES } from '../lib/domainMigrationStatus.js'
import { withTimeout } from '../lib/withTimeout.js'

const DEVICE_KEY = 'gym_app_domain_migration_device'
const inflight = new Map()
const preparing = new Set()

function deviceId() {
  // Нельзя сохранить идентификатор — нельзя надежно считать устройства.
  let id = localStorage.getItem(DEVICE_KEY)
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id ?? '')) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

function deviceLabel() {
  const ua = navigator.userAgent ?? ''
  if (/iPhone|iPod/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  return 'Браузер'
}

// Ошибка служебной отметки не мешает входу/синку. Перед переходом вызывающий
// отдельно проверяет результат: нельзя уходить, пока сервер не принял ready.
export async function reportMigrationCheck(userId, state = 'unknown') {
  try {
    const domain = migrationDomain(window.location, IS_BETA)
    if (!domain || !userId || !navigator.onLine || !(await hasSession(userId))) return false
    const { error } = await withTimeout(supabase.rpc('touch_domain_migration', {
      p_device_id: deviceId(), p_domain: domain, p_version: APP_VERSION,
      p_device_label: deviceLabel(),
      p_save_state: domain === 'old' && Object.hasOwn(MIGRATION_STATES, state) ? state : 'unknown',
    }), 8000)
    return !error
  } catch { return false /* повторим при следующем возвращении / heartbeat */ }
}

export async function touchDomainMigration(userId) {
  const domain = migrationDomain(window.location, IS_BETA)
  if (!domain || !userId || !navigator.onLine || inflight.has(userId) || preparing.has(userId)) return
  const task = (async () => {
    // Сразу убираем прежнее «сохранено»: новая активность требует новой проверки.
    await reportMigrationCheck(userId)
    if (domain !== 'old' || !(await hasSession(userId))) return
    let state
    try { state = await checkDomainMigration(userId) } catch { state = 'error' }
    // При смене базы/учетки не подтверждаем данные другой учетки.
    if (state !== 'account') await reportMigrationCheck(userId, state)
  })()
  inflight.set(userId, task)
  try { await task } catch { /* телеметрия необязательна */ } finally { inflight.delete(userId) }
}

// Подтверждение перед уходом со старого origin должно дойти ДО навигации.
// Heartbeat в это время не может затереть результат новой фоновой проверкой.
export async function prepareDomainMigration(userId) {
  if (preparing.has(userId)) return 'sync'
  preparing.add(userId)
  const d = db
  try {
    await inflight.get(userId)
    const result = await checkDomainMigration(userId)
    if (result !== 'ready') {
      await reportMigrationCheck(userId, result)
      return result
    }
    const recorded = await reportMigrationCheck(userId, 'ready')
    // За время RPC могли появиться черновик/очередь или смениться учетка.
    const fresh = await inspectDomainMigration(userId, d)
    if (fresh !== 'ready') {
      await reportMigrationCheck(userId, fresh)
      return fresh
    }
    return recorded ? 'ready' : 'report'
  } finally { preparing.delete(userId) }
}

export async function fetchDomainMigrationStatus(userId) {
  if (!navigator.onLine) throw new Error('Нет сети — статусы переезда доступны только онлайн.')
  if (!(await hasSession(userId))) throw new Error('Сессия не подтверждена — войди заново.')
  const { data, error } = await withTimeout(supabase.rpc('admin_domain_migration_status'), 10000)
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) throw new Error('На сервере еще нет статусов переезда — нужен накат SQL.')
    if (error.code === '42501') throw new Error('Нужны права администратора и подтверждение 2FA.')
    throw new Error('Не удалось загрузить статусы переезда. Повтори попытку.')
  }
  if (!Array.isArray(data)) throw new Error('Не удалось прочитать статусы переезда.')
  return data
}
