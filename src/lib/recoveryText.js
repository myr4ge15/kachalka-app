// Тексты подсказки «Восстановления» (v7.5.6) — одни для тизера Главной и экрана
// «Восстановление», чтобы формулировки не разъезжались. Без рода глагола: «последний
// раз 8 дней назад» верно и без пола в профиле (было «не тренировал уже 8 дней»).
// Чистый модуль.
import { groupAccusative } from './dayTags.js'
import { fmtDaysAgo, fmtDays } from './homeSummary.js'

// «Пора проработать спину» — без группы (для кнопки-ссылки на экране) отдает
// только начало фразы.
export const LEAD_TARGET = 'Пора проработать'
export function leadTarget(group) {
  return `${LEAD_TARGET} ${groupAccusative(group)}`
}

// «последний раз 8 дней назад»
export function leadSince(days) {
  return `последний раз ${fmtDaysAgo(days)}`
}

// «Кардио не было 8 дней»
export function cardioLine(days) {
  return `Кардио не было ${fmtDays(days)}`
}
