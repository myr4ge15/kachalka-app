// Маппинг серверных raise (admin-RPC) → человекочитаемых сообщений. Вынесен из
// admin.js в отдельный БЕЗ-зависимостей модуль, чтобы тестироваться без импорта
// supabase-клиента (РЕВЬЮ-КОДА-2026-07-13). Технические коды дословно не показываем.
export function humanRpc(message) {
  const m = String(message ?? '')
  if (m.includes('admin only') || m.includes('42501')) return 'Нужны права админа.'
  if (m.includes('cannot delete yourself')) return 'Нельзя удалить самого себя.'
  if (m.includes('cannot delete the last admin')) return 'Нельзя удалить последнего администратора.'
  if (m.includes('last admin')) return 'Нельзя снять роль с последнего админа.'
  // С П4 (07.10.2026) имена не уникальны — уникален логин (users_login_uidx).
  if (m.includes('users_login') || m.includes('duplicate key')) return 'Этот логин занят.'
  if (m.includes('rate limited')) return 'Слишком много операций подряд — подожди немного.'
  if (m.includes('invite already used')) return 'Ссылкой уже воспользовались — отозвать нельзя.'
  if (m.includes('0..60')) return 'Пометка — до 60 символов.'
  if (m.includes('not found')) return 'Запись не найдена.'
  if (m.includes('1..60')) return 'Название — от 1 до 60 символов.'
  if (m.includes('1..30') || m.includes('1..40')) return 'Имя — от 1 до 30 символов.'
  if (m.includes('function') || m.includes('schema')) return 'Сервер не готов: обнови серверную часть.'
  return m || 'Не удалось выполнить операцию.'
}
