// ============================================================================
// Smoke-e2e: единственный сквозной путь, ради которого приложение существует —
// «вход → записать тренировку → она в истории после перезагрузки».
//
// Ловит регрессии, которых не видят юниты и RTL: открытие персональной Dexie на
// входе, монтирование WorkoutScreen внутри HistoryScreen, сохранение через repo
// + очередь, чтение истории из локальной базы после полного рестарта страницы.
//
// Сеть НЕ участвует: navigator.onLine подменён на false (LoginScreen уходит в
// ветку офлайн-сверки PIN, синк не стартует), а любые запросы к supabase.co
// режутся route'ом. Локальное состояние «устройство уже входило» раскладывает
// src/test/e2eSeed.js (грузится в странице через vite dev-сервер).
// ============================================================================
import { test, expect } from '@playwright/test'

const APP = '/kachalka-app/'
const EXERCISE = 'Жим лёжа (e2e)'

test('вход → запись тренировки → она в истории после перезагрузки', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false, configurable: true })
  })
  await context.route(/supabase\.co/, (route) => route.abort())

  // Первый заход — только чтобы получить страницу с origin'ом (IndexedDB, модули).
  await page.goto(APP)
  const user = await page.evaluate(async () => {
    const seed = await import('/kachalka-app/src/test/e2eSeed.js')
    return seed.seedE2E()
  })
  await page.reload()

  // --- вход по PIN (офлайн-ветка) ------------------------------------------
  await page.getByRole('button', { name: user.name }).click()
  for (const digit of user.pin) {
    await page.locator('.keypad .key', { hasText: new RegExp(`^${digit}$`) }).click()
  }
  await expect(page.locator('.tabbar')).toBeVisible()

  // --- запись тренировки ----------------------------------------------------
  await page.locator('.tabbar .tab').filter({ hasText: 'Тренировки' }).click()
  
  // ИСПРАВЛЕНИЕ: На мобильном вьюпорте (390x844) используется плавающая 
  // кнопка «+» (FAB). Десктопная кнопка «+ Добавить тренировку» скрыта.
  await page.locator('.fab').click()
  
  await page.getByRole('button', { name: '+ Добавить упражнение' }).click()
  await page.locator('.picker-item').filter({ hasText: EXERCISE }).click()

  const set = page.locator('.set-row').first()
  await set.locator('input').first().fill('60')   // вес
  await set.locator('input').nth(1).fill('8')     // повторы

  await page.locator('.save-btn').click()

  // Сохранение вернуло в список, тренировка на месте.
  const card = page.locator('.history-card').first()
  await expect(card).toContainText(EXERCISE)
  await expect(card).toContainText('60×8')

  // --- перезагрузка: данные пережили рестарт (читаются из локальной Dexie) ---
  await page.reload()
  await page.locator('.tabbar .tab').filter({ hasText: 'Тренировки' }).click()

  const afterReload = page.locator('.history-card').first()
  await expect(afterReload).toContainText(EXERCISE)
  await expect(afterReload).toContainText('60×8')
  await expect(afterReload).toContainText('1 упр · 1 подх.')
})
