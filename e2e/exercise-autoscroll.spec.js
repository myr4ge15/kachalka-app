import { expect, test } from '@playwright/test'
import { seedAndLogin, switchableOnline } from './helpers.js'

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

test('касание у нижнего края прокручивает длинную тренировку вниз', async ({ page, context }) => {
  await switchableOnline(context)
  const user = await seedAndLogin(page)
  await page.evaluate(async id => {
    const { writeDraft } = await import('/kachalka-app/src/lib/draftStore.js')
    const { E2E_EXERCISES } = await import('/kachalka-app/src/test/e2eSeed.js')
    const entries = Array.from({ length: 18 }, (_, i) => ({
      exercise: { ...E2E_EXERCISES[0], id: 'exercise-' + i, name: 'Упражнение ' + i },
      sets: [{ weight: 20, reps: 8, _k: 'set-' + i }],
    }))
    writeDraft('workout_draft_new_' + id, entries)
  }, user.id)
  await page.getByRole('button', { name: 'Записать тренировку', exact: true }).click()
  const grip = page.getByRole('button', { name: /^Перетащить «Упражнение 1»/ })
  await grip.scrollIntoViewIfNeeded()
  const box = await grip.boundingBox()
  const session = await context.newCDPSession(page)
  const x = box.x + box.width / 2
  const touch = (type, y) => session.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
  })
  await touch('touchStart', box.y + box.height / 2)
  const cue = page.getByText('Прокрутка вниз', { exact: true })
  await expect(page.locator('.sort-active')).toHaveCount(1)
  const scroller = page.locator('main.content')
  const bounds = await scroller.boundingBox()
  const scrollTop = () => scroller.evaluate(el => el.scrollTop)
  const before = await scrollTop()
  await touch('touchMove', bounds.y + bounds.height - 24)
  await expect(cue).toHaveCount(0)
  await expect.poll(scrollTop).toBeGreaterThan(before + 200)
  await touch('touchEnd')
  await expect(page.locator('.sort-active')).toHaveCount(0)
  const rows = page.locator('.exercise-card')
  const ids = await rows.evaluateAll(items => items.map(el => el.dataset.exerciseId))
  expect(ids.indexOf('exercise-1')).toBeGreaterThan(1)
})
