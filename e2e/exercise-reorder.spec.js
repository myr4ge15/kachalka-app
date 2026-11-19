import { expect } from '@playwright/test'
import { test } from './browserstack-fixture.js'
import { enterPin } from './helpers.js'
import { setTimeout as delay } from 'node:timers/promises'

// Кольцо показывает полученное телефоном касание в записи. На события и раскладку не влияет.
async function showTouches(page) {
  await page.evaluate(() => {
    const ring = document.createElement('div')
    ring.ariaHidden = 'true'
    ring.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;width:22px;height:22px;border:3px solid cyan;border-radius:50%;box-shadow:0 0 0 1px black;transform:translate(-50%,-50%)'
    ring.hidden = true
    document.body.append(ring)
    const update = event => {
      const point = event.touches[0]
      ring.hidden = !point
      if (point) {
        ring.style.left = point.clientX + 'px'
        ring.style.top = point.clientY + 'px'
      }
    }
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      window.addEventListener(type, update, { capture: true, passive: true })
    }
  })
}

async function moveFinger(session, start, end, checkPosition) {
  const steps = 40
  for (let step = 1; step <= steps; step++) {
    const t = step / steps
    const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
    if (checkPosition && step % 8 === 0) await checkPosition(point)
    await delay(32)
  }
}

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
test('перетаскивание за ручку → новый порядок → черновик после перезагрузки', async ({ page, context }) => {
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
  await enterPin(page, user.pin)
  await page.getByRole('button', { name: 'Записать тренировку' }).click()
  const rows = page.locator('.exercise-card')
  await expect(rows).toHaveCount(2)
  const original = await rows.evaluateAll(items => items.map(el => el.dataset.exerciseId))
  const last = page.getByRole('button', { name: /^Перетащить «Подтягивания/ })
  await last.scrollIntoViewIfNeeded()
  const box = await last.boundingBox()
  const firstBox = await rows.first().boundingBox()
  const session = await context.newCDPSession(page)
  await showTouches(page)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  // Захват за ручку поднимает строку сразу.
  await expect(rows.last()).toHaveClass(/sort-lifted/)
  await expect(page.locator('.sort-chip')).toHaveText(/^Подтягивания/)
  const ty = Math.max(130, firstBox.y + 15)
  const chip = page.locator('.sort-chip')
  const { width } = await chip.boundingBox()
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  const grabOffset = Math.max(12, Math.min(width / 2, x - firstBox.x))
  await moveFinger(session, { x, y }, { x: 220, y: ty }, async point => {
    const left = Math.max(0, Math.min(viewportWidth - width, point.x - grabOffset))
    await expect.poll(async () => {
      const rect = await chip.boundingBox()
      return Math.hypot(rect.x - left, rect.y + rect.height / 2 - point.y)
    }, { message: 'Плашка упражнения следует за касанием по обеим осям' }).toBeLessThan(4)
  })
  await expect.poll(() => rows.last().evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeLessThan(-50)
  await expect.poll(async () => (await page.locator('.sort-chip').boundingBox()).x).toBeGreaterThan(100)
  // Первая карточка расступилась вниз — место видно до отпускания, порядок еще прежний.
  await expect.poll(() => rows.first().evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeGreaterThan(30)
  await expect(rows.last()).toHaveCSS('transition-duration', '0s')
  await expect(rows.first()).toHaveCSS('transition-duration', '0s')
  await expect(rows.first()).toHaveAttribute('data-exercise-id', original[0])
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(rows.first()).toHaveAttribute('data-exercise-id', original[1])
  await expect(page.locator('.exercise-card--active')).toHaveAttribute('data-exercise-id', original[0])
  await expect(page.locator('.sort-lifted, .sort-shift')).toHaveCount(0)

  // Раскрытую карточку на время перетаскивания сворачиваем в строку, после — снова раскрыта.
  const activeGrip = page.getByRole('button', { name: /^Перетащить «Жим лежа/ })
  const tb = await activeGrip.boundingBox()
  const tx = tb.x + 20, tyy = tb.y + tb.height / 2
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: tyy }] })
  await expect(page.locator(`[data-exercise-id="${original[0]}"]`)).toHaveClass(/exercise-card--compact/)
  await expect(page.locator(`[data-exercise-id="${original[0]}"]`)).toHaveClass(/sort-lifted/)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('.exercise-card--active')).toHaveAttribute('data-exercise-id', original[0])
  await expect(rows.first()).toHaveAttribute('data-exercise-id', original[1])
  // Бросаем в корзину и возвращаем упражнение вместе с подходом.
  await activeGrip.scrollIntoViewIfNeeded()
  const grip = await activeGrip.boundingBox()
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: grip.x + 10, y: grip.y + 10 }] })
  const trash = page.locator('.sort-trash')
  await expect(trash).toHaveClass(/show/)
  await trash.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  const bin = await trash.boundingBox()
  await moveFinger(session, { x: grip.x + 10, y: grip.y + 10 }, { x: bin.x + bin.width / 2, y: bin.y + bin.height / 2 })
  await expect(trash).toHaveClass(/hot/)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(rows).toHaveCount(1)
  await expect(page.locator('.sort-chip')).toHaveCount(0)
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect(rows).toHaveCount(2)
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
