import { test, expect } from '@playwright/test'

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
test('удержание → новый порядок → черновик после перезагрузки', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
  })
  await context.route(/supabase\.co/, route => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => {
    const seed = await import('/kachalka-app/src/test/e2eSeed.js')
    const u = await seed.seedE2E()
    const { writeDraft } = await import('/kachalka-app/src/lib/draftStore.js')
    writeDraft(`workout_draft_new_${u.id}`, seed.E2E_EXERCISES.map((exercise, i) => ({
      exercise, sets: [{ weight: i ? 0 : 60, reps: i ? 12 : 8, _k: `set-${i}` }],
    })))
    return u
  })
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  for (const digit of user.pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${digit}$`) }).click()
  await page.getByRole('button', { name: 'Записать тренировку' }).click()
  const rows = page.locator('.exercise-card')
  await expect(rows).toHaveCount(2)
  const original = await rows.evaluateAll(items => items.map(el => el.dataset.exerciseId))
  const last = page.getByRole('button', { name: /^Открыть Подтягивания/ })
  await last.scrollIntoViewIfNeeded()
  const box = await last.boundingBox()
  const firstBox = await rows.first().boundingBox()
  const session = await context.newCDPSession(page)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await expect(rows.last()).toHaveClass(/exercise-dragging/)
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.max(130, firstBox.y + 15) }] })
  await expect(rows.first()).toHaveClass(/exercise-drop-before/)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(rows.first()).toHaveAttribute('data-exercise-id', original[1])
  await expect(page.locator('.exercise-card--active')).toHaveAttribute('data-exercise-id', original[0])
  await page.reload()
  await page.getByRole('button', { name: 'Записать тренировку' }).click()
  await expect(rows.first()).toHaveAttribute('data-exercise-id', original[1])
  await page.getByRole('button', { name: /^Сохранить \(/ }).click()
  await expect(page.getByRole('dialog', { name: 'Тренировка готова' })).toBeVisible()
  const saved = await page.evaluate(async userId => {
    const { getWorkouts } = await import('/kachalka-app/src/db/repo.js')
    return (await getWorkouts(userId))[0].entries.map(e => ({ id: e.exercise_id, sets: e.sets }))
  }, user.id)
  expect(saved.map(e => e.id)).toEqual([...original].reverse())
  expect(saved[1].sets[0]).toMatchObject({ weight: 60, reps: 8 })
})
