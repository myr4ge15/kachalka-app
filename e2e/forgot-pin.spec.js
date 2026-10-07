// «Забыл PIN» (П1, v6.18.0): экран входа → ссылка в Telegram; ссылка #reset=… из бота
// открывает экран нового PIN и сразу исчезает из адреса. Сеть — только подмененный
// Edge pin-reset, остальное к supabase.co режется.
import { test, expect } from '@playwright/test'

const APP = '/kachalka-app/'
const T = 'a_tiNNP3RyzFJHQdG_xlbBkLpflaqExEUJzq2xU0eXo'

test.beforeEach(async ({ context }) => {
  await context.route(/supabase\.co/, async (route) => {
    const req = route.request()
    if (!/functions\/v1\/pin-reset$/.test(req.url())) return route.abort()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    const body = JSON.parse(req.postData() || '{}')
    const json = body.action === 'check' ? { status: 'invalid' } : { ok: true }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(json) })
  })
})

test('экран входа → «Забыл PIN?» → ссылка в Telegram', async ({ page }) => {
  await page.goto(APP)
  await page.getByRole('button', { name: 'Забыл PIN?' }).click()
  await page.getByLabel('Логин').fill('masha')
  await page.getByRole('button', { name: 'Прислать ссылку в Telegram' }).click()
  await expect(page.getByText(/бот уже прислал ссылку/)).toBeVisible()
  await page.getByRole('button', { name: 'Ввести код' }).click()
  await expect(page.getByLabel('Код восстановления')).toBeVisible()
})

test('ссылка #reset=… → экран нового PIN, токен стерт из адреса', async ({ page }) => {
  await page.goto(`${APP}#reset=${T}`)
  await expect(page.getByRole('heading', { name: 'Новый PIN' })).toBeVisible()
  await expect(page.getByText(/устарела/)).toBeVisible()
  expect(page.url()).not.toContain('reset=')
  await page.getByRole('button', { name: 'К входу' }).click()
  await expect(page.getByRole('button', { name: 'Забыл PIN?' })).toBeVisible()
})
