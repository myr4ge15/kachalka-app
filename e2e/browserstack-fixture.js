import { test as base } from '@playwright/test'
import { createRequire } from 'node:module'
import { appendFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const env = process.env
const origin = 'http://bs-local.com:5174'

// В обычном CI остаются стандартные fixtures. Облачному тесту нужны page и
// context одного Chrome на телефоне, в том числе для реальных touch-событий CDP.
export const test = env.BROWSERSTACK_ANDROID === '1' ? base.extend({
  context: async ({ browserName, playwright }, use, testInfo) => {
    const { version } = createRequire(import.meta.url)('@playwright/test/package.json')
    const caps = {
      browserName: browserName === 'chromium' ? 'chrome' : browserName, deviceName: 'Samsung Galaxy S25 Ultra', osVersion: '15.0',
      realMobile: 'true', project: 'kachalka-app', name: 'Workout drag, undo and persistence',
      build: `workout-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
      'browserstack.local': true,
      'browserstack.localIdentifier': `workout-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
      'browserstack.playwrightVersion': version,
      'client.playwrightVersion': version,
      'browserstack.video': true,
      'browserstack.username': env.BROWSERSTACK_USERNAME,
      'browserstack.accessKey': env.BROWSERSTACK_ACCESS_KEY,
    }
    // Playwright включает URL подключения в ошибки WebSocket. Маскируем весь
    // закодированный набор caps до открытия соединения.
    const encoded = encodeURIComponent(JSON.stringify(caps))
    console.log(`::add-mask::${encoded}`)
    const device = await playwright._android.connect(`wss://cdp.browserstack.com/playwright?caps=${encoded}`, { timeout: 90000 })
    try {
      await device.shell('am force-stop com.android.chrome')
      const context = await device.launchBrowser({
        baseURL: origin,
        args: [`--unsafely-treat-insecure-origin-as-secure=${origin}`],
      })
      const info = await context.newPage()
      try {
        const details = JSON.parse(await info.evaluate(() => {}, 'browserstack_executor: {"action":"getSessionDetails"}'))
        if (/^[0-9a-f]{40}$/i.test(details.hashed_id)) {
          await writeFile('session-id', details.hashed_id)
          if (details.browser_url?.startsWith('https://automate.browserstack.com/')) {
            const link = new URL(details.browser_url)
            await appendFile(env.GITHUB_STEP_SUMMARY, `Android: [сессия и видео](${link.origin}${link.pathname})\n`)
          }
        }
        await use(context)
      } finally {
        const status = testInfo.status === 'passed' ? 'passed' : 'failed'
        await info.evaluate(() => {}, `browserstack_executor: ${JSON.stringify({ action: 'setSessionStatus', arguments: { status, reason: testInfo.status } })}`).catch(() => {})
      }
    } finally {
      await device.close()
    }
  },
  page: async ({ context }, use) => {
    const page = await context.newPage()
    await page.bringToFront()
    await use(page)
  },
}) : base
