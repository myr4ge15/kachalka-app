// ============================================================================
// Категории для фильтра-чипов на экране «Уведомления».
//
// Пять типов уведомлений (getNotifications) сводим к четырем смысловым группам:
//   mine + goal + badge → 'records' (свои достижения: рекорды, цели, бейджи)
//   beaten          → 'beaten'    (кто побил мой рекорд)
//   reaction + comment_react → 'reactions' (реакции на мою тренировку и на мои комментарии)
//   comment         → 'comments'  (комментарии под моими тренировками и ответы мне, 26.10.2026)
//   insight         → 'insights'  (авто-выводы движка правил)
//
// Чистые функции без Dexie — фильтрация делается над уже готовым списком, модель
// «прочитано» (единый водяной знак) не трогаем: чипы прячут лишнее из рендера,
// но unread/markAllSeen считаются по ПОЛНОМУ списку.
// ============================================================================
import { cmpIsoAsc } from './cmp.js'

// Порядок = порядок чипов слева направо. 'all' всегда первым.
export const NOTIF_CATEGORIES = [
  { key: 'all', label: 'все' },
  { key: 'records', label: 'рекорды' },
  { key: 'beaten', label: 'побитые' },
  { key: 'reactions', label: 'реакции' },
  { key: 'comments', label: 'комментарии' },
  { key: 'insights', label: 'наблюдения' },
  { key: 'feedback', label: 'ответы' },
]

// Тип уведомления → ключ категории. Неизвестный тип относим к 'records'
// (консервативно: лучше показать в основной группе, чем спрятать).
export function notifCategory(type) {
  switch (type) {
    case 'mine':
    case 'goal':
    case 'badge':
      return 'records'
    case 'beaten':
      return 'beaten'
    case 'reaction':
    case 'comment_react': // реакция на мой комментарий — тоже реакция (26.10.2026)
      return 'reactions'
    case 'comment':
      return 'comments'
    case 'insight':
      return 'insights'
    case 'feedback':
      return 'feedback'
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

// Ограничение длины списка — ПО КАТЕГОРИЯМ (16.10, обращение fb_72a45812): общий срез «40 последних»
// давал одной волне событий (62 ответа разработчика за минуту) вытеснить рекорды и реакции, и чипы
// фильтра пропадали. list — уже свежие сверху; порядок сохраняется.
export function capPerCategory(list, perCategory) {
  const seen = new Map()
  return (list ?? []).filter((n) => {
    const c = notifCategory(n.type)
    const k = (seen.get(c) ?? 0) + 1
    seen.set(c, k)
    return k <= perCategory
  })
}

// Число непрочитанных = событий строго новее водяного знака «прочитано» (seen).
// Чистый счетчик над готовым списком: db-слой (notifications.countUnread) строит
// список и делегирует сюда — так логика счетчика тестируема без Dexie. Пустой
// seen (еще не открывали) < любой даты → все события непрочитаны.
export function unreadCount(list, seen) {
  const s = seen ?? ''
  return (list ?? []).filter((n) => cmpIsoAsc(s, n.at) < 0).length
}
