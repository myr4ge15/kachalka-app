// Набор упражнений сканером (8.4.0, идея владельца): найденное ложится в ленту, сканер
// продолжает работу, «Готово» добавляет все разом. Чистые правила ленты.

// Добавить найденное. Уже есть в ленте — та же лента (added: false): пока в рамке
// та же табличка, упражнение повторно не добавляется.
export function trayAdd(tray, exercise) {
  if (!exercise || tray.some((e) => e.id === exercise.id)) return { tray, added: false }
  return { tray: [...tray, exercise], added: true }
}

// «Еще на табличке»: сканер угадал не тот вариант — меняем ПОСЛЕДНЕЕ добавленное с той
// же таблички на выбранное. Выбранное уже есть в ленте — просто убираем угаданное.
export function trayReplace(tray, fromId, exercise) {
  if (!exercise || fromId === exercise.id) return tray
  if (!tray.some((e) => e.id === fromId)) return trayAdd(tray, exercise).tray
  if (tray.some((e) => e.id === exercise.id)) return tray.filter((e) => e.id !== fromId)
  return tray.map((e) => (e.id === fromId ? exercise : e))
}

