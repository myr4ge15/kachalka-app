import { test, expect } from '@playwright/test'
import { enterPin, tabbar } from './helpers.js'

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

test('camera label in the guide → result sheet → workout', async ({ page, context }) => {
  test.setTimeout(60_000)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    navigator.mediaDevices.getUserMedia = async () => {
      // Portrait, like a phone camera: the guide (centre of the 390×844 viewport)
      // frames the middle of the picture; the top line stays outside it.
      const canvas = document.createElement('canvas')
      canvas.width = 720; canvas.height = 1280
      const ctx = canvas.getContext('2d')
      const draw = () => {
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 720, 1280)
        ctx.fillStyle = 'black'; ctx.font = 'bold 52px Arial'
        ctx.fillText('LAT PULLDOWN', 170, 560)
        ctx.fillText('LEG EXTENSION', 170, 200) // Outside the guide: must not reach OCR.
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
  await enterPin(page, user.pin)
  await expect(tabbar(page)).toBeVisible()
  await page.evaluate(async () => {
    const { db } = await import('/kachalka-app/src/db/local.js')
    await db.exercises.put({ id: 'scanner-fixture', name: 'Тяга верхнего блока', muscle_group: 'спина', metric: 'weight' })
    await db.exercises.put({ id: 'scanner-outside', name: 'Разгибание ног в тренажере', muscle_group: 'ноги', metric: 'weight' })
  })
  await tabbar(page).getByRole('button', { name: 'Записать тренировку' }).click()
  await page.getByRole('button', { name: 'Добавить упражнение' }).click()
  await page.getByRole('button', { name: 'Сканировать название' }).click()
  const add = page.getByRole('button', { name: 'Добавить в тренировку' })
  await expect(add).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => window.scannerStopped)).toBe(true)
  await expect(page.getByRole('heading', { name: 'Тяга верхнего блока' })).toBeVisible()
  await expect(page.getByText(/Разгибание ног в тренажере/)).toHaveCount(0)
  await page.screenshot({ path: 'test-results/scanner-preview.png' })
  await add.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Тяга верхнего блока', { exact: true })).toBeVisible()
})
