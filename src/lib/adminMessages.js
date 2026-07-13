// Маппинг серверных raise (admin-RPC) → человекочитаемых сообщений. Вынесен из
// admin.js в отдельный БЕЗ-зависимостей модуль, чтобы тестироваться без импорта
// supabase-клиента (РЕВЬЮ-КОДА-2026-07-13). Технические коды дословно не показываем.
export function humanRpc(message) {
  const m = String(message ?? '')
  if (m.includes('admin only') || m.includes('42501')) return 'Нужны права админа.'
  if (m.includes('last admin')) return 'Нельзя снять роль с последнего админа.'
  if (m.includes('not found')) return 'Запись не найдена.'
  if (m.includes('1..60')) return 'Название — от 1 до 60 символов.'
  if (m.includes('1..40')) return 'Имя — от 1 до 40 символов.'
  if (m.includes('function') || m.includes('schema')) return 'Сервер не готов: обнови серверную часть.'
  return m || 'Не удалось выполнить операцию.'
}
