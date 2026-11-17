import { test, expect } from '@playwright/test'
import { enterPin, tabbar, openTab } from './helpers.js'

test('шаблон после перезагрузки подставляет веса из истории в новую тренировку', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  })
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => {
    const { seedE2E, E2E_EXERCISES } = await import('/kachalka-app/src/test/e2eSeed.js')
    const { saveTemplate, saveWorkout } = await import('/kachalka-app/src/db/repo.js')
    const { templateExercisesFromWorkout } = await import('/kachalka-app/src/lib/templateFromWorkout.js')
    const user = await seedE2E()
    await saveTemplate({ user_id: user.id, name: 'Точный план', exercises: templateExercisesFromWorkout([{
      exercise: E2E_EXERCISES[0], sets: [{ weight: 20, reps: 15 }, { weight: 80, reps: 8 }, { weight: 70, reps: 10 }],
    }, {
      exercise: E2E_EXERCISES[1], sets: Array.from({ length: 18 }, () => ({ weight: 0, reps: 8 })),
    }]) })
    await saveWorkout({ user_id: user.id, performed_at: '2026-01-01T12:00:00Z', entries: [{
      exercise: E2E_EXERCISES[0], sets: [{ weight: 25, reps: 12 }, { weight: 85, reps: 6 }],
    }] })
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
  const save = page.getByRole('button', { name: 'Сохранить', exact: true })
  const addExercise = page.getByRole('button', { name: 'Добавить упражнение', exact: true })
  await addExercise.click()
  const picker = page.getByRole('dialog', { name: 'Упражнение' })
  const exercise = picker.getByRole('button', { name: 'Жим лежа (e2e)', exact: true })
  await expect(exercise.getByText('середина груди', { exact: false })).toBeVisible()
  await expect(exercise).toContainText('Также — трицепс, передняя дельта')
  await picker.getByRole('button', { name: 'закрыть' }).click()
  const content = page.locator('.content')
  await expect(save).toBeInViewport({ ratio: 1 })
  const portraitSave = await save.boundingBox()
  expect(portraitSave.y + portraitSave.height).toBeLessThan((await tabbar(page).boundingBox()).y)
  for (const viewport of [{ width: 568, height: 320 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport)
    await content.evaluate((node) => { node.scrollTop = 0 })
    await expect(save).toBeInViewport({ ratio: 1 })
    const before = await save.boundingBox()
    await content.evaluate((node) => { node.scrollTop = node.scrollHeight })
    expect(await content.evaluate((node) => node.scrollTop)).toBeGreaterThan(500)
    expect((await save.boundingBox()).y).toBeCloseTo(before.y)
    const add = await addExercise.boundingBox()
    expect(add.y + add.height).toBeLessThan(before.y)
    await expect(addExercise).toBeInViewport({ ratio: 1 })
    await save.click({ trial: true })
  }
  await content.evaluate((node) => { node.scrollTop = 0 })
  const bench = page.locator('.tpl-ex').filter({ hasText: 'Жим лежа (e2e)' })
  const secondWeight = bench.getByLabel('Вес или дистанция подхода 2', { exact: true })
  await secondWeight.fill('82.5')
  await expect(secondWeight).toHaveValue('82.5')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'work/template-editor-mobile.png', fullPage: true })
  await save.click()
  await expect(page.getByRole('button', { name: '+ Новый шаблон' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Записать тренировку' }).click()
  await page.getByRole('button', { name: 'Выбрать шаблон' }).click()
  const plan = page.getByRole('dialog', { name: 'Выбрать шаблон' }).getByRole('button', { name: /Точный план/ })
  const gutter = await plan.evaluate((row) => {
    const list = row.parentElement
    return list.getBoundingClientRect().left + list.clientWidth - row.getBoundingClientRect().right
  })
  expect(gutter).toBeGreaterThanOrEqual(10)
  await plan.click()
  const sets = page.locator('.exercise-card--active .set-row')
  await expect(sets).toHaveCount(3)
  for (const [i, weight, reps] of [[0, '25', '15'], [1, '85', '8'], [2, '70', '10']]) {
    await expect(sets.nth(i).locator('input').nth(0)).toHaveValue(weight)
    await expect(sets.nth(i).locator('input').nth(1)).toHaveValue(reps)
  }
})
