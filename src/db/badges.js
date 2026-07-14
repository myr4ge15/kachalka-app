// ============================================================================
// Достижения / бейджи — слой БД (PLAN-badges, Slice 1b). Читает уже локальные
// данные (свои тренировки) и кормит их чистому движку src/lib/badges.js; даты
// получения хранит в персональной meta (repo.getBadges/writeBadges). Схему/синк
// не трогаем — всё из денормализованных entries, офлайн-доступно.
//
// Необратимость (PLAN §2.1): выданный бейдж не снимается, даже если показатель
// позже упал — поэтому дату штампуем один раз и дальше опираемся на неё.
// Бэкфилл (PLAN §2.2): исторические вехи размечаются задним числом ТИХО
// (backfilled:true) — без тоста и без записи на «Колокольчик». Тост/колокольчик —
// только за живое получение на сохранении тренировки.
// ============================================================================
import { getWorkouts, getBadges, writeBadges } from './repo.js'
import { nowIso } from './local.js'
import {
  BADGES,
  BADGE_CATS,
  currentValues,
  badgeProgress,
  evaluateBadges,
  nextBadge,
  badgeEarnedDates,
} from '../lib/badges.js'

const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]))

// Данные экрана «Достижения»: категории с плитками (получен + дата ИЛИ прогресс),
// сводка (получено X из Y) и ближайшая незакрытая веха. Только чтение.
export async function getBadgesView(userId) {
  const [workouts, earnedMap] = await Promise.all([getWorkouts(userId), getBadges(userId)])
  const values = currentValues(workouts)
  const cats = BADGE_CATS.map((c) => {
    const defs = BADGES.filter((b) => b.cat === c.cat)
    const badges = defs.map((def) => {
      const progress = badgeProgress(def, values)
      const rec = earnedMap[def.id]
      // Получен = закрыт сейчас ИЛИ уже отмечен в meta (необратимость).
      const done = progress.done || !!rec
      return { def, done, at: rec?.at ?? null, backfilled: !!rec?.backfilled, progress }
    })
    return {
      cat: c.cat,
      label: c.label,
      icon: c.icon,
      badges,
      earnedCount: badges.filter((b) => b.done).length,
      total: defs.length,
      // Подпись «макс. серия за историю» у секции серий (Slice 2) — та самая
      // величина, что засчитывает вехи серий.
      note: c.cat === 'streak' && values.maxStreakWeeks > 0
        ? `макс. серия: ${values.maxStreakWeeks} нед`
        : null,
    }
  })
  const { earned } = evaluateBadges(values, earnedMap)
  return {
    cats,
    total: BADGES.length,
    earnedCount: earned.length,
    next: nextBadge(values),
    values,
  }
}

// Тихая разметка исторических вех (первый заход на экран). Проставляет дату всем
// закрытым, но ещё не отмеченным бейджам как backfilled — чтобы у полученных была
// дата и держалась необратимость. Идемпотентно; не создаёт тостов/уведомлений.
export async function backfillBadges(userId) {
  const [workouts, earnedMap] = await Promise.all([getWorkouts(userId), getBadges(userId)])
  const values = currentValues(workouts)
  const dates = badgeEarnedDates(workouts) // точные исторические даты (Slice 2)
  const next = { ...earnedMap }
  let changed = false
  const now = nowIso()
  for (const def of BADGES) {
    if (!next[def.id] && badgeProgress(def, values).done) {
      next[def.id] = { at: dates[def.id] ?? now, backfilled: true }
      changed = true
    }
  }
  if (changed) await writeBadges(userId, next)
}

// Новые бейджи, закрытые ИМЕННО этим сохранением (для тоста после тренировки).
// Штампует их даты в meta и возвращает определения для показа. ПЕРВЫЙ проход
// (meta ещё пуста — фича только включилась у пользователя с историей) считаем
// бэкфиллом: даты проставляем, но тост НЕ показываем и на «Колокольчик» не шлём
// (не спамим десятком исторических вех). Дальше — уже живое получение с тостом.
export async function detectBadgesOnSave(userId) {
  const [workouts, earnedMap] = await Promise.all([getWorkouts(userId), getBadges(userId)])
  const firstPass = Object.keys(earnedMap).length === 0
  const values = currentValues(workouts)
  const { newlyEarned } = evaluateBadges(values, earnedMap)
  if (!newlyEarned.length) return []
  const now = nowIso()
  // Первый проход (бэкфилл истории) — исторические даты; живое получение — сейчас.
  const dates = firstPass ? badgeEarnedDates(workouts) : null
  const next = { ...earnedMap }
  for (const id of newlyEarned) {
    next[id] = { at: firstPass ? (dates[id] ?? now) : now, backfilled: firstPass }
  }
  await writeBadges(userId, next)
  if (firstPass) return []
  return newlyEarned.map((id) => BADGE_BY_ID[id]).filter(Boolean)
}
