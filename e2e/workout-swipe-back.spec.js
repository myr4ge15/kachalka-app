import { test, expect } from '@playwright/test'

// v8.4.0: открытая тренировка закрывается свайпом вправо (iOS «на экране Домой»),
// под карточкой виден список. Перетаскивание упражнения — не свайп.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
test('свайп из тренировки ведет к списку, перетаскивание упражнения — нет', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    Object.defineProperty(navigator, 'userAgent', { get: () => 'iPhone' })
    Object.defineProperty(navigator, 'standalone', { get: () => true })
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

  // 1) Удержание названия и ведение пальца вправо-вниз — сортировка, экран на месте.
  const session = await context.newCDPSession(page)
  const first = page.getByLabel(/^Жим лежа \(e2e\)\. Изменить порядок/)
  const b = await first.boundingBox()
  const x = b.x + 30, y = b.y + b.height / 2
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await expect(rows.first()).toHaveClass(/sort-lifted/)
  for (const dx of [20, 60, 120, 200]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + 4 }] })
  }
  await expect(page.locator('.content [data-swiping]')).toHaveCount(0)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()

  // 2) Свайп вправо от середины: карточка едет, под ней список; довел — список.
  await page.waitForTimeout(600) // подавление клика после сортировки
  // От подсказки под шапкой: не поле и не ручка — «пустое» место экрана.

  const hint = await page.locator('.exercise-reorder-hint').boundingBox()
  const sy = hint.y + hint.height / 2
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: sy }] })

  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: sy }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: sy }] })

  const underlay = page.locator('.nav-stack[data-swiping] > .nav-underlay')

  await expect(underlay).toBeVisible()
  await expect(underlay.getByRole('heading', { name: 'Мои тренировки', includeHidden: true })).toHaveCount(1)
  await page.screenshot({ path: 'test-results/workout-swipe-midpoint.png' })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByRole('heading', { name: 'Мои тренировки' })).toBeVisible()
  await expect(page.locator('.workout-screen')).toHaveCount(0)
  await expect(page.locator('.content [data-swiping]')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/workout-swipe-return.png' })
})
