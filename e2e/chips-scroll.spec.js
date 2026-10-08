import { test, expect } from '@playwright/test'

test.use({ hasTouch: true, viewport: { width: 390, height: 500 } })

test('чипы листаются пальцем в пикере и во вложенной форме', async ({ page, context }) => {
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto('/kachalka-app/')
  await page.evaluate(async () => {
    const { default: React } = await import('/kachalka-app/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/kachalka-app/node_modules/.vite/deps/react-dom_client.js')
    const { default: ExercisePicker } = await import('/kachalka-app/src/components/ExercisePicker.jsx')
    const host = document.createElement('div')
    document.body.append(host)
    ReactDOM.createRoot(host).render(React.createElement(ExercisePicker, {
      exercises: ['грудь', 'спина', 'ноги', 'плечи', 'бицепс', 'трицепс', 'пресс'].map((g, i) => ({ id: String(i), name: g, muscle_group: g })),
      onPick() {}, onClose() {}, onCreate() {},
    }))
  })
  const session = await context.newCDPSession(page)
  async function swipe(row, direction) {
    const box = await row.boundingBox()
    const x = box.x + box.width * (direction < 0 ? 0.8 : 0.2)
    const y = box.y + box.height / 2
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 10; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x + direction * step * 20, y: y + step * 0.5 }],
      })
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const dialog = page.getByRole('dialog')
  async function checkRow(row) {
    await expect(row).toBeVisible()
    await swipe(row, -1)
    await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBeGreaterThan(50)
    const before = await row.evaluate(el => el.scrollLeft)
    await swipe(row, 1)
    await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBeLessThan(before - 30)
  }
  await checkRow(dialog.locator('.chips').first())
  await dialog.getByRole('button', { name: '+ добавить свое упражнение' }).click()
  await dialog.getByRole('button', { name: 'грудь', exact: true }).click()
  await checkRow(dialog.locator('.chips').first())
  // Вертикальный скролл формы после горизонтального жеста по-прежнему доступен.
  const body = dialog.locator('.sheet-scroll')
  await expect.poll(() => body.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0)
})
