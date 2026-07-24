// ============================================================================
// Синк локального `meta` (BACKLOG «Синк локального meta») — ЧИСТАЯ логика.
//
// Часть пользовательских данных исторически лежала только в персональной Dexie-
// meta и терялась при смене устройства/чистке браузера: даты бейджей, настройки
// автопрогрессии, метка «прочитано» в уведомлениях. Серверное хранилище —
// одна маленькая таблица `user_meta(user_id, key, value jsonb, updated_at)`
// (supabase/user-meta.sql), обвязка синка — db/userMeta.js + sync/push|pull.
//
// Здесь только чистые функции (без Dexie/сети): какие ключи синкаем, как
// сливать два состояния и что делать по итогам pull. Сливаем ПО ТИПУ КЛЮЧА, а
// не тупым last-write-wins, потому что для двух из трёх ключей LWW теряет данные:
//   - notif_seen_at — водяной знак «прочитано»: берём МАКСИМУМ. Иначе устройство
//     с отставшей меткой откатывает её назад, и уведомления «всплывают»
//     непрочитанными туда-сюда (пинг-понг между телефоном и ноутом);
//   - badges — карта {badgeId: {at, backfilled}}: ОБЪЕДИНЯЕМ, у каждой вехи
//     держим САМУЮ РАННЮЮ дату. Веха, взятая офлайн на другом устройстве, не
//     должна исчезать, а полученная «живьём» — деградировать до backfilled;
//   - prog — настройки автопрогрессии: связный документ, частичное слияние
//     бессмысленно → last-write-wins по updated_at (кто правил позже, тот прав).
// ============================================================================
import { cmpIsoAsc } from './cmp.js'

// Синкаемые ключи. Значение — «род» ключа: локальный ключ в Dexie-meta это
// `${kind}_${userId}`, серверный key — сам kind (владелец там колонкой).
// ⚠️ Расширять ОДНОВРЕМЕННО с белым списком в upsert_user_meta (user-meta.sql),
// иначе push упрётся в ошибку `unknown user_meta key`.
export const SYNCED_KINDS = ['badges', 'prog', 'notif_seen_at']

// Локальный ключ персональной meta по роду и пользователю.
export const metaKeyFor = (kind, userId) => `${kind}_${userId}`

// Стабильная сериализация для сравнения значений (порядок ключей объекта не
// должен влиять на «изменилось ли»): рекурсивно сортируем ключи.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = stable(v[k])
    return out
  }
  return v
}

// Равны ли два значения meta (null и undefined считаем одним «пусто»).
export function sameMetaValue(a, b) {
  if (a == null && b == null) return true
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b))
}

// Слияние карты бейджей: объединение по badgeId, у каждой вехи — самая ранняя
// дата получения. backfilled (историческая разметка, не показывается на
// колокольчике) остаётся true, только если ОБЕ стороны считают веху исторической:
// «живое» получение важнее и не должно тихо превращаться в backfill.
function mergeBadges(local, remote) {
  const a = local && typeof local === 'object' ? local : {}
  const b = remote && typeof remote === 'object' ? remote : {}
  const out = {}
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id]
    const y = b[id]
    if (!x) { out[id] = y; continue }
    if (!y) { out[id] = x; continue }
    out[id] = {
      ...x,
      ...y,
      at: cmpIsoAsc(x.at, y.at) <= 0 ? x.at : y.at,
      backfilled: Boolean(x.backfilled) && Boolean(y.backfilled),
    }
  }
  return out
}

// Слить локальное и серверное значение одного ключа. localAt/remoteAt — время
// последней правки каждой стороны (нужно только для LWW-родов).
export function mergeMetaValue({ kind, local, remote, localAt, remoteAt }) {
  if (remote == null) return local ?? null
  if (local == null) return remote
  switch (kind) {
    case 'notif_seen_at':
      // Обе стороны — ISO-строка. Максимум = «прочитано» не откатывается назад.
      return cmpIsoAsc(local, remote) >= 0 ? local : remote
    case 'badges':
      return mergeBadges(local, remote)
    default:
      // prog и всё будущее без своего правила — last-write-wins. Часы разные
      // (локальные vs серверные), но расхождение в секунды роли не играет:
      // спор возможен, только если один и тот же ключ правили на двух
      // устройствах между синками. При равенстве оставляем локальное.
      return cmpIsoAsc(localAt, remoteAt) >= 0 ? local : remote
  }
}

// Решение по одному ключу после pull. Возвращает:
//   value — что должно лежать локально;
//   write — надо ли перезаписать локальное значение (не дёргаем useLiveQuery зря);
//   dirty — надо ли отправить результат на сервер (слияние дало не то, что там);
//   at    — новая отметка времени в состоянии синка.
// hasRemote=false (строки на сервере ещё нет) — это первый залив: локальное
// значение помечаем dirty, чтобы ближайший push его забэкофиллил.
export function planMetaSync({ kind, local, remote, localAt, remoteAt, hasRemote, now }) {
  if (!hasRemote) {
    return { value: local ?? null, write: false, dirty: local == null ? 0 : 1, at: localAt ?? now }
  }
  const value = mergeMetaValue({ kind, local, remote, localAt, remoteAt })
  const matchesRemote = sameMetaValue(value, remote)
  return {
    value,
    write: !sameMetaValue(value, local),
    dirty: matchesRemote ? 0 : 1,
    // Победило серверное состояние → берём серверный watermark; иначе значение
    // ещё поедет наверх, отметку ставим локальную (её перепишет push).
    at: matchesRemote ? remoteAt : now,
  }
}
