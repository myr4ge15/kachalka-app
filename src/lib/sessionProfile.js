// ============================================================================
// Профиль сессии из «тонкого» localStorage — чистые хелперы БЕЗ Dexie/сети.
//
// Безопасность общих телефонов: в localStorage держим ТОЛЬКО id вошедшего, а имя
// и роль (PII + признак админа) НЕ храним открыто — тянем из loginDb на
// восстановлении. Раньше там лежал весь объект {id,name,role}, читаемый любым, у
// кого доступ к устройству/devtools.
//
// Источники восстановления:
//   name — ростер loginDb.users (обновляется pull'ом login_users, самый свежий);
//          фолбэк — офлайн-кэш PIN; иначе null (шапка подтянет имя, как загрузится
//          ростер, через отдельный эффект в App).
//   role — ТОЛЬКО офлайн-кэш PIN (в ростер/view login_users роль не отдаётся);
//          иначе null (не-админ; серверные операции всё равно гейтятся is_admin()).
// ============================================================================

// Прочитать id вошедшего из сырого значения localStorage. Совместимо со старым
// «толстым» форматом {id,name,role} (берём .id) и с голой id-строкой.
export function readStoredUserId(raw) {
  if (raw == null || raw === '') return null
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object') return v.id ?? null
    if (typeof v === 'string') return v || null
    if (typeof v === 'number') return String(v)
    return null
  } catch {
    // Не-JSON (например, голый id старого формата) — трактуем как id.
    return typeof raw === 'string' && raw ? raw : null
  }
}

// Собрать профиль сессии из id и офлайн-источников (ростер + кэш PIN).
// name: ростер → кэш → null; role: только кэш → null.
export function hydrateProfile(id, roster, cache) {
  return {
    id,
    name: roster?.name ?? cache?.name ?? null,
    role: cache?.role ?? null,
  }
}
