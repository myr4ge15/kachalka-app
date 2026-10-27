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
import { VIEW_ALL_KEY, viewAllExtra } from '../lib/viewAll.js'

export function getViewAll(d = db) {
  return getMeta(VIEW_ALL_KEY, d).then((v) => v ?? null)
}

// Тренировки «чужих» — из кэша Ленты: после режима их не видно (их и вычислял сервер как невидимых без него).
async function dropFromFeed(extra, d) {
  if (!extra.size) return
  const ids = await d.feed.filter((w) => extra.has(w.user_id)).primaryKeys()
  if (ids.length) await d.feed.bulkDelete(ids)
}

export async function resetViewAllCaches(d = db) {
  if (!d) return
  const members = await d.meta.where('key').startsWith('member_').primaryKeys()
  await d.meta.bulkDelete([...members, FEED_SIG])
}

// Режим кончился (кнопка, срок, сервер сказал «нет»). Сразу — чистка и снимок без срока: плашка и раздел гаснут
// мгновенно (fb_de151d74: ждали полный синк, «Выключаю…» висело секунды), а «чужие» уходят из кэша Ленты
// (fb_fda86ffe: синк, уже шедший в этот момент, Ленту не перечитывал — «чужой» оставался без метки, и комментарий
// отклонял сервер). Фоном — перечитать и снять снимок. Возвращает { done } — промис фонового хвоста.
export async function endViewAll(userId, d = db) {
  if (!d) return { done: Promise.resolve() }
  const prev = await getViewAll(d)
  await resetViewAllCaches(d)
  await dropFromFeed(viewAllExtra(prev), d)
  await setMeta(VIEW_ALL_KEY, { until: null, extra: prev?.extra ?? [] }, d)
  const done = (async () => {
    try { await syncNow(userId) } catch { /* синк сам покажет ошибку; снимок все равно снимаем */ }
    try { await d.meta.delete(VIEW_ALL_KEY) } catch { /* база уже закрыта (выход) — снимок уйдет с ней */ }
  })()
  return { done }
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

// Ждет только сервер и мгновенную часть; { done } — фоновый хвост (для тестов).
export async function disableViewAll(userId, d = db) {
  await viewAllOff(userId)
  return endViewAll(userId, d)
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
  // Снимок без срока — хвост прошлого выключения не дошел (закрыли приложение): дочищаем так же.
  if (prev) await (await endViewAll(userId, d)).done
  return null
}
