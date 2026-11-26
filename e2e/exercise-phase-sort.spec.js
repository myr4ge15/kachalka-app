import { expect, test } from '@playwright/test'
import { enterPin, openTab } from './helpers.js'

test.use({ hasTouch: true, viewport: { width: 393, height: 793 } })

for (const editor of ['тренировка', 'шаблон']) {
  test(`${editor}: границы блоков и отступы во время переноса совпадают с результатом`, async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await context.route(/supabase\.co/, route => route.abort())
    await page.goto('/kachalka-app/')
    const user = await page.evaluate(async () => {
      const { seedE2E, E2E_EXERCISES } = await import('/kachalka-app/src/test/e2eSeed.js')
      const u = await seedE2E()
      const entries = ['w', 'a', 'b', 'c'].map((id, i) => ({
        exercise: { ...E2E_EXERCISES[0], id, name: 'Упражнение ' + id },
        phase: ['warmup', undefined, undefined, 'cooldown'][i],
        sets: [{ weight: 12, reps: 8, _k: id }],
      }))
      const { writeDraft } = await import('/kachalka-app/src/lib/draftStore.js')
      writeDraft('workout_draft_new_' + u.id, entries)
      const { saveTemplate } = await import('/kachalka-app/src/db/repo.js')
      await saveTemplate({ user_id: u.id, name: 'Блоки', exercises: entries.map(({ exercise, phase }) => ({ exercise, phase, sets: 1, reps: 8 })) })
      return u
    })
    await page.reload()
    await page.getByRole('button', { name: user.name }).click()
    await enterPin(page, user.pin)
    if (editor === 'тренировка') {
      await page.getByRole('button', { name: 'Записать тренировку', exact: true }).click()
    } else {
      await openTab(page, 'Тренировки')
      await page.getByRole('button', { name: 'Шаблоны', exact: true }).click()
      await page.getByRole('button', { name: /Мои шаблоны/ }).click()
      await page.getByRole('button', { name: /^Блоки/ }).click()
    }
    const list = page.locator('.phase-sort-list')
    const grip = list.locator('[data-exercise-id="a"] .exercise-grip, [data-tpl-id="a"] .tpl-handle')
    await grip.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    const from = await grip.boundingBox()
    const x = from.x + from.width / 2
    const session = await context.newCDPSession(page)
    const touch = (type, y) => session.send('Input.dispatchTouchEvent', {
      type, touchPoints: y === undefined ? [] : [{ x, y }],
    })
    await touch('touchStart', from.y + from.height / 2)
    const b = list.locator('[data-exercise-id="b"], [data-tpl-id="b"]')
    await b.scrollIntoViewIfNeeded()
    const target = await b.boundingBox()
    await touch('touchMove', target.y + target.height / 2)
    await expect.poll(() => b.evaluate(el => el.style.order)).not.toBe('')
    // Во время жеста возможна автопрокрутка. Все координаты превью берём из одного кадра.
    const orderAndGaps = () => list.evaluate(list => {
      const children = [...list.children].filter(el => !el.hidden).map(el => ({
        id: el.dataset.sortPhase || el.dataset.exerciseId || el.dataset.tplId,
        top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight,
      })).sort((a, b) => a.top - b.top)
      const slot = list.querySelector('.sort-slot')?.getBoundingClientRect()
      const heading = list.querySelector('[data-sort-phase="cooldown"]').getBoundingClientRect()
      return {
        order: children.map(el => el.id),
        gaps: children.slice(1).map((el, i) => el.top - children[i].bottom),
        cooldownGap: slot ? heading.top - slot.bottom : null,
      }
    })
    const preview = await orderAndGaps()
    expect(preview.order).toEqual(['warmup', 'w', 'main', 'b', 'a', 'cooldown', 'c'])
    expect(preview.gaps.every(gap => gap >= 0 && gap <= 10)).toBe(true)
    if (editor === 'тренировка') expect(preview.cooldownGap).toBeGreaterThanOrEqual(0)
    await touch('touchEnd')
    await expect(list.locator('.sort-lifted')).toHaveCount(0)
    expect((await orderAndGaps()).order).toEqual(preview.order)

    // Отдельный жест из основной части за последнюю карточку заминки.
    // При отмене возвращаются и исходное место, и заголовки.
    await grip.scrollIntoViewIfNeeded()
    const again = await grip.boundingBox()
    await touch('touchStart', again.y + again.height / 2)
    const c = list.locator('[data-exercise-id="c"], [data-tpl-id="c"]')
    await c.scrollIntoViewIfNeeded()
    const cooldown = await c.boundingBox()
    await touch('touchMove', cooldown.y + cooldown.height / 2)
    await expect.poll(async () => (await orderAndGaps()).order)
      .toEqual(['warmup', 'w', 'main', 'b', 'cooldown', 'c', 'a'])
    await touch('touchCancel')
    await expect(list.locator('.sort-lifted')).toHaveCount(0)
    expect((await orderAndGaps()).order).toEqual(preview.order)
  })
}
