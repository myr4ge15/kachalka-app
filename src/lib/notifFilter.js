// ============================================================================
// Категории для фильтра-чипов на экране «Уведомления».
//
// Пять типов уведомлений (getNotifications) сводим к четырём смысловым группам:
//   mine  + goal    → 'records'   (свои достижения: рекорды и цели)
//   beaten          → 'beaten'    (кто побил мой рекорд)
//   reaction        → 'reactions' (реакции друзей на мою тренировку)
//   insight         → 'insights'  (авто-выводы движка правил)
//
// Чистые функции без Dexie — фильтрация делается над уже готовым списком, модель
// «прочитано» (единый водяной знак) не трогаем: чипы прячут лишнее из рендера,
// но unread/markAllSeen считаются по ПОЛНОМУ списку.
// ============================================================================

// Порядок = порядок чипов слева направо. 'all' всегда первым.
export const NOTIF_CATEGORIES = [
  { key: 'all', label: 'Все' },
  { key: 'records', label: 'Рекорды' },
  { key: 'beaten', label: 'Побитые' },
  { key: 'reactions', label: 'Реакции' },
  { key: 'insights', label: 'Выводы' },
]

// Тип уведомления → ключ категории. Неизвестный тип относим к 'records'
// (консервативно: лучше показать в основной группе, чем спрятать).
export function notifCategory(type) {
  switch (type) {
    case 'mine':
    case 'goal':
      return 'records'
    case 'beaten':
      return 'beaten'
    case 'reaction':
      return 'reactions'
    case 'insight':
      return 'insights'
    default:
      return 'records'
  }
}

// Фильтр списка по ключу категории. 'all'/пусто → список без изменений.
export function filterNotifs(list, category) {
  const items = list ?? []
  if (!category || category === 'all') return items
  return items.filter((n) => notifCategory(n.type) === category)
}

// Чипы только для реально присутствующих категорий (плюс 'all'), чтобы не
// показывать пустые фильтры. Порядок — как в NOTIF_CATEGORIES.
export function activeCategories(list) {
  const present = new Set((list ?? []).map((n) => notifCategory(n.type)))
  return NOTIF_CATEGORIES.filter((c) => c.key === 'all' || present.has(c.key))
}
