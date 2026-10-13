// Мелкие текстовые хелперы ввода. Чистые, без React/DOM.

// Оставить только цифры и обрезать до max символов. Для полей PIN (4 цифры) —
// раньше эта строка дублировалась в ProfileScreen и AdminScreen
// (РЕВЬЮ-КОДА-2026-07-13). max по умолчанию 4 (длина PIN).
// Название упражнения для записи: обрезанное, «ё» → «е» (v7.4.1). В каталоге одно
// написание — иначе «лёжа» и «лежа» читались как разные упражнения и путали поиск
// и дубли. Миграция существующих — supabase/exercise-names-no-yo.sql.
export function cleanExerciseName(s) {
  return String(s ?? '').trim().replace(/ё/g, 'е').replace(/Ё/g, 'Е')
}

export function onlyDigits(s, max = 4) {
  const digits = String(s ?? '').replace(/\D/g, '')
  return max == null ? digits : digits.slice(0, max)
}
