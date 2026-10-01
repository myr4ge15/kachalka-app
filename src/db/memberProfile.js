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
// ============================================================================
import { supabase, isConfigured, hasSession } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { db, getMeta, setMeta } from './local.js'
import { SELECT_FEED, rowToItem, computePrs } from './feed.js'
import { MEMBER_LIMIT } from '../lib/memberProfile.js'

export const memberKey = (memberId) => `member_${memberId}`

// Снимок из кэша: { at, total, items, source:'cache'|'feed' } или null.
export async function getCachedMember(memberId, d = db) {
  if (!d || !memberId) return null
  const cached = await getMeta(memberKey(memberId), d)
  if (cached?.items) return { ...cached, source: 'cache' }
  // user_id в таблице feed не индексирован (схему не трогаем) — окно ленты 50 строк.
  const fromFeed = (await d.feed.toArray()).filter((i) => i.user_id === memberId)
  if (!fromFeed.length) return null
  return { at: null, total: null, items: fromFeed, source: 'feed' }
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
  // Счетчик — украшение: упал → считаем по окну (lib/memberProfile.js).
  const total = count.error ? null : (count.count ?? null)
  await setMeta(memberKey(memberId), { at: Date.now(), total, items }, d)
  return true
}
