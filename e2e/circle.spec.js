// «Мой круг» (07.10.2026): ссылка #join=<код> без учетки — превью «кто зовет и куда» и
// форма регистрации (Edge invite-redeem подменен); вошедший — «Мой круг» из Профиля.
import { test, expect } from '@playwright/test'

const APP = '/kachalka-app/'

test('ссылка #join=… без учетки → «Сега зовет тебя в круг «Зал»», код стерт из адреса', async ({ page, context }) => {
  await context.route(/supabase\.co/, async (route) => {
    const req = route.request()
    if (!/functions\/v1\/invite-redeem$/.test(req.url())) return route.abort()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    const body = JSON.parse(req.postData() || '{}')
    const json = body.action === 'circle_check' && body.code === '7F3Q9XWD'
      ? { status: 'ok', circle_name: 'Зал', inviter_name: 'Сега' } : { status: 'invalid' }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) })
  })
  await page.goto(`${APP}#join=7f3q-9xwd`)
  await expect(page.getByText(/зовет тебя в круг/)).toContainText('Сега зовет тебя в круг «Зал»')
  expect(page.url()).not.toContain('join=')
  await expect(page.getByLabel('Логин (для входа)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Зарегистрироваться' })).toBeVisible()
})

test('вошедший: Профиль → «Мой круг»; без сети — понятная плашка', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }))
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.goto(APP)
  const user = await page.evaluate(async () => (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  for (const digit of user.pin) await page.locator('.keypad .key', { hasText: new RegExp(`^${digit}$`) }).click()
  await page.getByRole('button', { name: 'Открыть профиль' }).click()
  await page.getByRole('button', { name: /Мой круг/ }).click()
  await expect(page.getByRole('heading', { name: 'Мой круг' })).toBeVisible()
  await expect(page.getByText('«Мой круг» работает только с интернетом.')).toBeVisible()
  await page.getByRole('button', { name: /Назад/ }).first().click()
  await expect(page.getByRole('button', { name: /Мой круг/ })).toBeVisible()
})
