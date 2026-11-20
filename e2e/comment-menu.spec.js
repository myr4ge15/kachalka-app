import { expect, test } from '@playwright/test'

test.use({ hasTouch: true, viewport: { width: 360, height: 640 } })

test('действия длинного комментария доступны для тапа до и после поворота телефона', async ({ page }) => {
  await page.route(/supabase\.co/, (route) => route.abort())
  await page.goto('/kachalka-app/')
  await page.evaluate(async () => {
    const { default: React } = await import('/kachalka-app/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/kachalka-app/node_modules/.vite/deps/react-dom_client.js')
    const { default: CommentMenu } = await import('/kachalka-app/src/components/social/CommentMenu.jsx')
    const host = document.createElement('div')
    host.className = 'sheet cm-sheet'
    host.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;max-height:none;z-index:250'
    const bubble = document.createElement('div')
    bubble.className = 'cm-bub cm-text'
    bubble.textContent = Array(40).fill('Строка').join('\n')
    host.append(bubble)
    document.body.append(host)
    const mount = document.createElement('div')
    host.append(mount)
    const actions = ['Ответить', 'Копировать'].map((label) => ({ key: label, label, onSelect: () => { host.dataset.picked = label } }))
    const reactions = { onPick: kind => { host.dataset.picked = kind } }
    ReactDOM.createRoot(mount).render(React.createElement(CommentMenu, { anchor: bubble, actions, reactions }))
  })
  const copy = page.getByRole('menuitem', { name: 'Копировать' })
  const fire = page.getByRole('button', { name: 'Огонь' })
  const sheet = page.locator('.sheet.cm-sheet')
  for (const size of [{ width: 360, height: 640 }, { width: 740, height: 360 }]) {
    await page.setViewportSize(size)
    // Имитируем прокрутку внешнего листа за фокусом при повороте Chromium.
    // У длинного комментария содержимое выше листа в обеих ориентациях.
    await sheet.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(copy).toBeInViewport({ ratio: 1 })
    await expect(fire).toBeInViewport({ ratio: 1 })
    await fire.tap()
    await expect(sheet).toHaveAttribute('data-picked', 'fire')
    await copy.tap()
    await expect(sheet).toHaveAttribute('data-picked', 'Копировать')
  }
})
