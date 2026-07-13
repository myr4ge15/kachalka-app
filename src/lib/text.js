// Мелкие текстовые хелперы ввода. Чистые, без React/DOM.

// Оставить только цифры и обрезать до max символов. Для полей PIN (4 цифры) —
// раньше эта строка дублировалась в ProfileScreen и AdminScreen
// (РЕВЬЮ-КОДА-2026-07-13). max по умолчанию 4 (длина PIN).
export function onlyDigits(s, max = 4) {
  const digits = String(s ?? '').replace(/\D/g, '')
  return max == null ? digits : digits.slice(0, max)
}
