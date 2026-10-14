// ============================================================================
// Слияние дублей в Админке (v8.2.0) — чистые правила выбора. Те же, что проверяет
// сервер (supabase/admin-merge-exercise.sql): клиент лишь не предлагает заведомо
// отказные пары.
//
// «Скрыто» значит две разные вещи: админ убрал упражнение из пикера (вернуть можно)
// и упражнение слито в другое (merged_into — постоянный алиас: на нем держится
// перевод офлайн-записей со старого id, удалять и «показывать» его нельзя).
// Алиасы в списке Админки не показываем — только счетчиком (mergedSummary).
// ============================================================================

// Слитый алиас: у строки есть ссылка на основное упражнение.
export function isMergedAlias(ex) {
  return Boolean(ex?.merged_into)
}

// Что можно слить: любое, кроме уже слитого (скрытое из пикера — можно).
export function mergeSources(exercises) {
  return (exercises ?? []).filter((e) => !isMergedAlias(e))
}

// Во что можно слить `fromId`: видимое, не алиас, не оно само; общее — только в
// общее (иначе общий справочник оказался бы «своим» у одного человека).
export function mergeTargets(exercises, fromId) {
  const list = exercises ?? []
  const from = list.find((e) => e.id === fromId)
  return list.filter(
    (e) => e.id !== fromId && !e.is_hidden && !isMergedAlias(e) && !(from && !from.is_custom && e.is_custom)
  )
}

// Сводка слитых для Админки: по основному упражнению — сколько в него слито.
// [{ id, name, count }] по убыванию count, затем по имени. Алиас, чья цель не
// найдена (невидима по правам), считается под своим именем.
export function mergedSummary(exercises) {
  const list = exercises ?? []
  const byId = new Map(list.map((e) => [e.id, e]))
  const acc = new Map()
  for (const e of list) {
    if (!isMergedAlias(e)) continue
    const target = byId.get(e.merged_into)
    const key = target?.id ?? e.merged_into
    const cur = acc.get(key) ?? { id: key, name: target?.name ?? e.name ?? '', count: 0 }
    cur.count += 1
    acc.set(key, cur)
  }
  return [...acc.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
}
