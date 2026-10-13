import { test, expect } from '@playwright/test'

test('local OCR reads English and Russian under application CSP', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/kachalka-app/')
  const result = await page.evaluate(async () => {
    const { createScannerWorker } = await import('/kachalka-app/src/services/scannerOcr.js')
    const worker = await createScannerWorker()
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1000; canvas.height = 230
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 230)
      ctx.fillStyle = 'black'; ctx.font = 'bold 60px Arial'
      ctx.fillText('LAT PULLDOWN', 30, 85)
      ctx.fillText('ЖИМ НОГАМИ', 30, 175)
      return (await worker.recognize(canvas)).data.text
    } finally { await worker.terminate() }
  })
  expect(result).toContain('LAT PULLDOWN')
  expect(result).toContain('ЖИМ НОГАМИ')
})

test('camera label → explicit selection → workout', async ({ page, context }) => {
  test.setTimeout(60_000)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1000; canvas.height = 600
      const ctx = canvas.getContext('2d')
      const draw = () => {
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 600)
        ctx.fillStyle = 'black'; ctx.font = 'bold 72px Arial'
        ctx.fillText('LAT PULLDOWN', 70, 320)
        ctx.fillText('LEG EXTENSION', 70, 90) // Outside the guide: must not reach OCR.
      }
      draw()
      const stream = canvas.captureStream(5)
      const interval = setInterval(draw, 200)
      const track = stream.getTracks()[0]
      const stop = track.stop.bind(track)
      track.stop = () => { clearInterval(interval); stop(); window.scannerStopped = true }
      return stream
    }
  })
  await context.route(/supabase\.co/, route => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  for (const digit of user.pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${digit}$`) }).click()
  await expect(page.locator('.tabbar')).toBeVisible()
  await page.evaluate(async () => {
    const { db } = await import('/kachalka-app/src/db/local.js')
    await db.exercises.put({ id: 'scanner-fixture', name: 'Тяга верхнего блока', muscle_group: 'спина', metric: 'weight' })
    await db.exercises.put({ id: 'scanner-outside', name: 'Разгибание ног в тренажере', muscle_group: 'ноги', metric: 'weight' })
  })
  await page.locator('.tabbar').getByRole('button', { name: 'Записать тренировку' }).click()
  await page.getByRole('button', { name: 'Добавить упражнение' }).click()
  await page.getByRole('button', { name: 'Сканировать название' }).click()
  await expect(page.getByRole('button', { name: 'Выбрать упражнение' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Выбрать упражнение' })).toBeDisabled()
  expect(await page.evaluate(() => window.scannerStopped)).toBe(true)
  await expect(page.getByRole('button', { name: /Разгибание ног в тренажере/ })).toHaveCount(0)
  await page.getByRole('button', { name: /Тяга верхнего блока/ }).click()
  await page.screenshot({ path: 'test-results/scanner-preview.png' })
  await page.getByRole('button', { name: 'Выбрать упражнение' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Тяга верхнего блока', { exact: true })).toBeVisible()
})
