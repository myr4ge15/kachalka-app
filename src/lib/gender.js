// Род глагола по полу (v6.2.5): «не тренировал» / «не тренировала». Пол — из
// ростера (users.sex: 'm' | 'f' | null). Не указан → мужская форма, как и раньше.
// Чистая функция, без React/Dexie.
export function byGender(sex, male, female) {
  return sex === 'f' ? female : male
}
