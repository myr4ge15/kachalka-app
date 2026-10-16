import { test, expect } from '@playwright/test'
import { enterPin, tabbar, openTab } from './helpers.js'

test('точный шаблон: редактор → перезагрузка → новая тренировка', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  })
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => {
    const { seedE2E, E2E_EXERCISES } = await import('/kachalka-app/src/test/e2eSeed.js')
    const { saveTemplate } = await import('/kachalka-app/src/db/repo.js')
    const { templateExercisesFromWorkout } = await import('/kachalka-app/src/lib/templateFromWorkout.js')
    const user = await seedE2E()
    await saveTemplate({ user_id: user.id, name: 'Точный план', exercises: templateExercisesFromWorkout([{
      exercise: E2E_EXERCISES[0], sets: [{ weight: 20, reps: 15 }, { weight: 80, reps: 8 }, { weight: 70, reps: 10 }],
    }]) })
    return user
  })
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await expect(tabbar(page)).toBeVisible()
  await openTab(page, 'Тренировки')
  await page.getByRole('button', { name: /Шаблоны/ }).click()
  await page.getByRole('button', { name: /Мои шаблоны/ }).click()
  await page.getByRole('button', { name: /Точный план/ }).click()
  await page.getByLabel('Вес или дистанция подхода 2').fill('82.5')
  await expect(page.getByLabel('Вес или дистанция подхода 2')).toHaveValue('82,5')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'work/template-editor-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByRole('button', { name: '+ Новый шаблон' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Записать тренировку' }).click()
  await page.getByRole('button', { name: 'Выбрать шаблон' }).click()
  await page.getByRole('button', { name: /Точный план/ }).click()
  const sets = page.locator('.exercise-card--active .set-row')
  await expect(sets).toHaveCount(3)
  for (const [i, weight, reps] of [[0, '20', '15'], [1, '82,5', '8'], [2, '70', '10']]) {
    await expect(sets.nth(i).locator('input').nth(0)).toHaveValue(weight)
    await expect(sets.nth(i).locator('input').nth(1)).toHaveValue(reps)
  }
})
