// ============================================================================
// «Видеть всех» — онлайн-вызовы режима админа (27.10.2026, docs/plans/PLAN-admin-view-all.md).
// Сервер — supabase/migrations/20261027120000_admin_view_all.sql: admin_view_all_set/_off/_state/
// _extra_ids (DEFINER, гейт is_admin() — роль и 2FA-сессия). Вне очередей синка: режим — не данные
// тренировок, офлайн его включать незачем (как прочие операции Админки, lib/admin.js).
// ============================================================================
import { supabase, hasSession } from '../db/supabase.js'
import { withTimeout } from './withTimeout.js'
import { AdminError, MFA_REQUIRED_TEXT } from './admin.js'

export const VIEW_ALL_NO_SQL = 'На сервере нет режима «Видеть всех» — нужен накат SQL.'
export const VIEW_ALL_OFFLINE = 'Нет сети — режим включается и выключается только онлайн.'
export const VIEW_ALL_NO_SESSION = 'Сессия не подтверждена — выйди из учетки и войди заново.'

function fail(error) {
  const code = error?.code ?? ''
  const msg = String(error?.message ?? '')
  if (code === '42883' || code === 'PGRST202' || /could not find the function/i.test(msg)) return new AdminError(VIEW_ALL_NO_SQL)
  if (code === '42501' || /not admin/.test(msg)) return new AdminError(MFA_REQUIRED_TEXT)
  if (/view_all_bad_minutes/.test(msg)) return new AdminError('Срок — от 5 минут до 4 часов.')
  return new AdminError(msg || 'Не получилось — попробуй еще раз.')
}

async function guard(userId) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AdminError(VIEW_ALL_OFFLINE)
  if (!(await hasSession(userId))) throw new AdminError(VIEW_ALL_NO_SESSION)
}

async function rpc(name, args) {
  const res = await withTimeout(args ? supabase.rpc(name, args) : supabase.rpc(name))
  if (res.error) throw fail(res.error)
  return res.data
}

// Включить на minutes минут. Возвращает срок (ISO).
export async function viewAllOn(userId, minutes) {
  await guard(userId)
  return rpc('admin_view_all_set', { p_minutes: minutes })
}

export async function viewAllOff(userId) {
  await guard(userId)
  await rpc('admin_view_all_off')
}

// Состояние с сервера: { until: ISO | null, extra: [userId] } — extra только при идущем режиме.
export async function viewAllState(userId) {
  await guard(userId)
  const until = (await rpc('admin_view_all_state')) ?? null
  if (!until) return { until: null, extra: [] }
  const rows = await rpc('admin_view_all_extra_ids')
  // setof uuid PostgREST отдает массивом строк; на всякий случай понимаем и объекты.
  const extra = (rows ?? []).map((r) => (typeof r === 'string' ? r : r?.admin_view_all_extra_ids)).filter(Boolean)
  return { until, extra }
}
