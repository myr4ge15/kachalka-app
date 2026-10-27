// ============================================================================
// «Видеть всех» — снимок режима админа в персональной meta и чистка после него
// (27.10.2026, docs/plans/PLAN-admin-view-all.md). Онлайн-вызовы — lib/adminViewAll.js.
//
// meta[VIEW_ALL_KEY] = { until, extra } — пока режим идет (и до чистки после него). По extra
// Лента и профиль метят «чужих» и прячут действия, уведомления их пропускают.
// Чистка: в режиме чужие данные оседают в кэшах. Упражнения, шаблоны и ростер pull вычищает
// сам (сигнатуры наборов id), «в сети» на диск не пишется. Руками — снимки профилей member_*
// и метка окна Ленты (иначе неизменное по сигнатуре окно не перечиталось бы сразу).
// ============================================================================
import { db, getMeta, setMeta } from './local.js'
import { FEED_SIG } from './feed.js'
import { syncNow } from './sync.js'
import { viewAllOn, viewAllOff, viewAllState } from '../lib/adminViewAll.js'
import { VIEW_ALL_KEY } from '../lib/viewAll.js'

export function getViewAll(d = db) {
  return getMeta(VIEW_ALL_KEY, d).then((v) => v ?? null)
}

export async function resetViewAllCaches(d = db) {
  if (!d) return
  const members = await d.meta.where('key').startsWith('member_').primaryKeys()
  await d.meta.bulkDelete([...members, FEED_SIG])
}

// Режим кончился (кнопка, срок, сервер сказал «нет»): чистка → перечитать → снять снимок.
// Снимок снимаем последним: пока Лента перечитывается, «чужие» в ней еще помечены.
export async function endViewAll(userId, d = db) {
  if (!d) return
  await resetViewAllCaches(d)
  await syncNow(userId)
  await d.meta.delete(VIEW_ALL_KEY)
}

// Включить на minutes. Ошибки (нет сети, нет 2FA, нет SQL) — наружу, текстом AdminError.
export async function enableViewAll(userId, minutes, d = db) {
  const until = await viewAllOn(userId, minutes)
  let extra = []
  try { extra = (await viewAllState(userId)).extra } catch { /* пометки подтянет следующая сверка */ }
  await setMeta(VIEW_ALL_KEY, { until, extra }, d)
  await syncNow(userId)
  return until
}

export async function disableViewAll(userId, d = db) {
  await viewAllOff(userId)
  await endViewAll(userId, d)
}

// Сверка с сервером (вход, возврат в приложение, конец срока). Не бросает: нет сети или
// функции на сервере — снимок не трогаем, сверимся в следующий раз.
export async function refreshViewAll(userId, d = db) {
  if (!d) return null
  let s
  try { s = await viewAllState(userId) } catch { return getViewAll(d) }
  const prev = await getViewAll(d)
  if (s.until) {
    const next = { until: s.until, extra: s.extra }
    if (prev?.until !== next.until || String(prev?.extra) !== String(next.extra)) await setMeta(VIEW_ALL_KEY, next, d)
    return next
  }
  if (prev) await endViewAll(userId, d)
  return null
}
