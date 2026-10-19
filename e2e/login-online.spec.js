// ============================================================================
// Вход с сетью (v6.14.0, LoginScreen.submitPin): онлайн экран входа сначала ждет
// Edge auth-login, локальный кэш PIN — только запасной путь, когда сервер недоступен
// (сеть, таймаут, 5xx). «Неверный PIN» и «лок» сервера кэшем не обходятся, иначе
// старый PIN пускал бы после сброса или смены на другом телефоне.
// Остальные спеки входят офлайн и этот путь не видят (покрытие тестами 19.10.2026).
// ============================================================================
import { test, expect } from '@playwright/test'
import { enterPin, fulfillJson, setOnline, switchableOnline, tabbar } from './helpers.js'

const APP = '/kachalka-app/'

// auth-login отвечает status; все прочее к Supabase режем. Возвращает счетчик вызовов.
async function setup(page, context, status, body = {}) {
  const calls = { login: 0 }
  await switchableOnline(context)
  await context.route(/supabase\.co/, (route) => {
    if (/functions\/v1\/auth-login$/.test(route.request().url())) {
      if (route.request().method() !== 'OPTIONS') calls.login++
      return fulfillJson(route, body, status)
    }
    return route.abort()
  })
  await page.goto(APP)
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await setOnline(page, true, { fire: false })
  await page.getByRole('button', { name: user.name }).click()
  return { user, calls }
}

test('сервер сказал «неверный PIN» — кэш с этим PIN не пускает', async ({ page, context }) => {
  const { user, calls } = await setup(page, context, 401, { error: 'invalid' })
  await enterPin(page, user.pin) // в кэше устройства этот PIN верный
  await expect(page.getByText('Неверный PIN')).toBeVisible()
  expect(calls.login).toBe(1)
  await expect(tabbar(page)).toHaveCount(0)
})

test('сервер запер вход (429) — понятный текст, кэш не пускает', async ({ page, context }) => {
  const { user } = await setup(page, context, 429, { retry_after: 900 })
  await enterPin(page, user.pin)
  await expect(page.getByText(/Слишком много попыток/)).toBeVisible()
  await expect(tabbar(page)).toHaveCount(0)
})

test('сервер лежит (503) — вход по кэшу PIN, как офлайн', async ({ page, context }) => {
  const { user, calls } = await setup(page, context, 503, { error: 'down' })
  await enterPin(page, user.pin)
  await expect(tabbar(page)).toBeVisible()
  // Сначала ждали сервер (а не кэш сразу); после входа по кэшу сессию добирает фоновый вход.
  expect(calls.login).toBeGreaterThanOrEqual(1)
})

test('сервер лежит, PIN неверный — кэш тоже не пускает', async ({ page, context }) => {
  await setup(page, context, 503, { error: 'down' })
  await enterPin(page, '9999')
  await expect(page.getByText('Неверный PIN')).toBeVisible()
  await expect(tabbar(page)).toHaveCount(0)
})
