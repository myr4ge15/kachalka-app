// ============================================================================
// Профиль другого участника (v6.7.0) — read-only витрина, как лента.
//
// Тот же «слой витрин», что db/feed.js и db/leaderboard.js: прямой read-only
// запрос к `workouts` под RLS и кэш в Dexie. Ничего не пишет на сервер, схему не
// меняет. Видимость решает сервер (`can_see_user()`): приватного или чужого круга
// RLS просто не отдаст — клиент своих правил видимости НЕ заводит, поэтому при
// переходе на видимость «по кругам» экран поедет за сервером сам.
//
// Кэш — в персональном `meta` под `member_${memberId}` (служебное, не синкается,
// как `sig_*`): { at, total, items }. Пока кэша нет — показываем тренировки
// участника из уже скачанной ленты, чтобы экран не был пустым офлайн.
//
// Реакции (v6.7.1): тянем тем же запросом, что лента; тап пишет в общую очередь
// `reaction_outbox` (repo.toggleReaction — она же правит кэш ленты) и сразу правит
// снимок профиля. При чтении поверх снимка накладываем неотправленные операции
// очереди — свежий fetch не съест оптимистичный тап.
// ============================================================================
import { supabase, isConfigured, hasSession } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { db, getMeta, setMeta } from './local.js'
import { SELECT_FEED, rowToItem, computePrs, attachReactions } from './feed.js'
import { toggleReaction } from './repo.js'
import { applyReactionQueue } from '../lib/reactions.js'
import { MEMBER_LIMIT } from '../lib/memberProfile.js'

export const memberKey = (memberId) => `member_${memberId}`

// Снимок из кэша: { at, total, items, source:'cache'|'feed' } или null.
// me = { id, name } зрителя — для наложения его неотправленных реакций.
export async function getCachedMember(memberId, me = null, d = db) {
  if (!d || !memberId) return null
  const cached = await getMeta(memberKey(memberId), d)
  let snap = null
  if (cached?.items) snap = { ...cached, source: 'cache' }
  else {
    // user_id в таблице feed не индексирован (схему не трогаем) — окно ленты 50 строк.
    const fromFeed = (await d.feed.toArray()).filter((i) => i.user_id === memberId)
    if (fromFeed.length) snap = { at: null, total: null, items: fromFeed, source: 'feed' }
  }
  if (!snap || !me?.id) return snap
  try {
    const ops = await d.reaction_outbox.toArray()
    if (ops.length) snap.items = applyReactionQueue(snap.items, ops, me)
  } catch { /* нет очереди — как есть */ }
  return snap
}

// Тап по реакции в профиле участника: общая очередь + кэш ленты (repo), затем
// оптимистичная правка снимка профиля (иначе после отправки очереди реакция
// «мигнула» бы до следующего fetchMember).
export async function toggleMemberReaction({ userId, userName, memberId, workoutId, kind, mine }, d = db) {
  await toggleReaction({ userId, userName, workoutId, kind, mine })
  const cached = await getMeta(memberKey(memberId), d)
  if (!cached?.items) return
  const items = applyReactionQueue(cached.items, [{ workoutId, kind, op: mine ? 'remove' : 'add' }], { id: userId, name: userName })
  await setMeta(memberKey(memberId), { ...cached, items }, d)
}

// Подтянуть свежий снимок с сервера и положить в кэш. Офлайн / без сессии — тихо
// выходит (false). Сетевые и серверные ошибки бросает — экран покажет плашку.
export async function fetchMember(viewerId, memberId, d = db) {
  if (!isConfigured || !navigator.onLine || !memberId) return false
  if (!(await hasSession(viewerId))) return false

  const [list, count] = await Promise.all([
    withTimeout(
      supabase
        .from('workouts')
        .select(SELECT_FEED)
        .eq('user_id', memberId)
        .order('performed_at', { ascending: false })
        .limit(MEMBER_LIMIT)
    ),
    withTimeout(
      supabase
        .from('workouts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', memberId)
    ),
  ])
  if (list.error) throw list.error
  const items = (list.data ?? []).map(rowToItem)
  computePrs(items) // отметки рекордов на карточках — по окну участника, как в ленте
  await attachReactions(items) // сбой/нет таблицы — карточки без реакций, как в ленте
  // Счетчик — украшение: упал → считаем по окну (lib/memberProfile.js).
  const total = count.error ? null : (count.count ?? null)
  await setMeta(memberKey(memberId), { at: Date.now(), total, items }, d)
  return true
}
