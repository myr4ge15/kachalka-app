// Маппинг серверных raise (admin-RPC) → человекочитаемых сообщений. Вынесен из
// admin.js в отдельный БЕЗ-зависимостей модуль, чтобы тестироваться без импорта
// supabase-клиента (РЕВЬЮ-КОДА-2026-07-13). Технические коды дословно не показываем.
export function humanRpc(message) {
  const m = String(message ?? '')
  if (m.includes('admin only') || m.includes('42501')) return 'Нужны права админа.'
  if (m.includes('cannot delete yourself')) return 'Нельзя удалить самого себя.'
  if (m.includes('cannot delete the last admin')) return 'Нельзя удалить последнего администратора.'
  if (m.includes('last admin')) return 'Нельзя снять роль с последнего админа.'
  // Уникальный индекс имен (invites.sql, v6.8.0): регистр, ё/е, латинские двойники.
  if (m.includes('users_name_key') || m.includes('duplicate key')) return 'Это имя уже занято.'
  if (m.includes('rate limited')) return 'Слишком много операций подряд — подожди немного.'
  if (m.includes('invite already used')) return 'Ссылкой уже воспользовались — отозвать нельзя.'
  if (m.includes('0..60')) return 'Пометка — до 60 символов.'
  if (m.includes('not found')) return 'Запись не найдена.'
  if (m.includes('1..60')) return 'Название — от 1 до 60 символов.'
  if (m.includes('1..40')) return 'Имя — от 1 до 40 символов.'
  if (m.includes('function') || m.includes('schema')) return 'Сервер не готов: обнови серверную часть.'
  return m || 'Не удалось выполнить операцию.'
}
