import { test, expect } from '@playwright/test'
import { enterPin } from './helpers.js'

// Координаты неподвижных деталей на сцене 320 × 224. Цвет и толщина штриха
// слегка различаются между позами, поэтому допускаем один пиксель вокруг линии.
const anchors = {
  'plie-squat': [107, 204, 225, 222], // стопы в обеих полных фазах
  'standing-barbell-press': [134, 172, 198, 223], // стопы
  'seated-dumbbell-press': [101, 165, 223, 222], // низ скамьи и стопы
  'machine-shoulder-press': [94, 157, 237, 222],
  'seated-overhead-extension': [91, 139, 222, 218],
  'pec-deck': [107, 163, 238, 221],
  'seated-leg-curl': [173, 1, 216, 55], // верх спинки
  'lat-pulldown': [113, 170, 196, 218], // сиденье
  'face-pull': [103, 177, 179, 215], // пояс
  'hanging-leg-raise': [86, 5, 222, 21], // перекладина
  'standing-hip-abduction': [185, 102, 271, 210], // стул
  'floor-glute-bridge': [4, 137, 128, 195], // затылок и рука на полу
  'bulgarian-split-squat': [59, 187, 110, 207], // опора задней ноги
  'hack-squat': [39, 175, 88, 208], // платформа для стоп
  'step-up': [187, 158, 217, 189], // правая ножка тумбы
}

test('кадры всех карточек открываются, опоры исправленных пар совпадают', async ({ page }) => {
  await page.goto('/kachalka-app/')
  const scores = await page.evaluate(async anchors => {
    const { TECHNIQUE } = await import('/kachalka-app/src/content/technique.js')
    const { techniqueFrameUrl } = await import('/kachalka-app/src/lib/technique.js')
    const scores = {}
    for (const [slug, card] of Object.entries(TECHNIQUE)) {
      const region = anchors[slug]
      const images = await Promise.all(card.frames.map(async frame => {
        const img = new Image()
        img.src = techniqueFrameUrl(frame.file, '/kachalka-app/', frame.revision)
        await img.decode()
        return img
      }))
      if (!region) continue
      const [left, top, right, bottom] = region
      const width = right - left
      const height = bottom - top
      const masks = images.map(img => {
        const canvas = document.createElement('canvas')
        canvas.width = 320
        canvas.height = 224
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, 320, 224)
        const scale = Math.min(320 / img.naturalWidth, 224 / img.naturalHeight)
        const w = img.naturalWidth * scale
        const h = img.naturalHeight * scale
        ctx.drawImage(img, (320 - w) / 2, (224 - h) / 2, w, h)
        const { data } = ctx.getImageData(left, top, width, height)
        return Uint8Array.from({ length: width * height }, (_, i) => data[i * 4] < 175)
      })
      function overlap(a, b) {
        let ink = 0
        let matched = 0
        for (let i = 0; i < a.length; i++) {
          if (!a[i]) continue
          ink++
          const x = i % width
          const y = Math.floor(i / width)
          let found = false
          for (let row = Math.max(0, y - 1); row <= Math.min(height - 1, y + 1); row++) {
            for (let col = Math.max(0, x - 1); col <= Math.min(width - 1, x + 1); col++) {
              if (b[row * width + col]) found = true
            }
          }
          if (found) matched++
        }
        return ink >= 30 ? matched / ink : 0
      }
      scores[slug] = Math.min(overlap(masks[0], masks[1]), overlap(masks[1], masks[0]))
    }
    return scores
  }, anchors)
  for (const slug of Object.keys(anchors)) expect(scores[slug], slug).toBeGreaterThan(0.85)
})

test('в жиме Арнольда стопы остаются на месте при смене кадров', async ({ page }) => {
  await page.goto('/kachalka-app/')
  const drift = await page.evaluate(async () => {
    const { TECHNIQUE } = await import('/kachalka-app/src/content/technique.js')
    const bottoms = await Promise.all(TECHNIQUE['arnold-press'].frames.map(async ({ file }) => {
      const image = new Image()
      image.src = '/kachalka-app/technique/' + file
      await image.decode()
      // Тот же contain, что в сцене высотой 240 px с полями по 8 px.
      const canvas = document.createElement('canvas')
      canvas.width = 224
      canvas.height = 224
      const ctx = canvas.getContext('2d')
      const width = image.naturalWidth * canvas.height / image.naturalHeight
      ctx.drawImage(image, (canvas.width - width) / 2, 0, width, canvas.height)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      for (let pixel = canvas.width * canvas.height - 1; pixel >= 0; pixel--) {
        if (data[pixel * 4 + 3] > 200 && data[pixel * 4] < 128) return Math.floor(pixel / canvas.width)
      }
      throw new Error('В кадре нет контура фигуры')
    }))
    return Math.abs(bottoms[0] - bottoms[1])
  })
  expect(drift).toBeLessThanOrEqual(1)
})

// Подсказка «Как выполнять» (v8.0.0): открывается из карточки и из пикера, ничего
// не меняет в тренировке, закрывается без потери введенного и места в пикере.
test('подсказка по технике: карточка и пикер, данные тренировки не меняются', async ({ page, context }) => {
  await context.route(/supabase\.co/, route => route.abort())
  await page.goto('/kachalka-app/')
  const user = await page.evaluate(async () => {
    const seed = await import('/kachalka-app/src/test/e2eSeed.js')
    const bench = {
      id: 'e2e-ex-tech-bench', name: 'Жим лежа со штангой', muscle_group: 'грудь',
      submuscle: 'chest_middle', secondary: ['triceps'], metric: 'weight', is_custom: false, is_hidden: false,
    }
    const u = await seed.seedE2E({ exercises: [...seed.E2E_EXERCISES, bench] })
    const { writeDraft } = await import('/kachalka-app/src/lib/draftStore.js')
    writeDraft(`workout_draft_new_${u.id}`, [{ exercise: bench, sets: [{ weight: 62.5, reps: 7, _k: 's1' }] }])
    return u
  })
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await page.getByRole('button', { name: 'Записать тренировку' }).click()

  // Из карточки: лист с текстом и кадром; Escape закрывает, значения на месте.
  const info = page.getByRole('button', { name: 'Как выполнять: Жим лежа со штангой' })
  await info.click()
  const sheet = page.getByRole('dialog', { name: 'Жим лежа со штангой' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Частые ошибки' })).toBeVisible()
  const frame = sheet.locator('img.is-on')
  await expect(frame).toBeVisible()
  await expect.poll(() => frame.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('62.5')
  await expect(page.getByLabel('Повторения, подход 1')).toHaveValue('7')
  await expect(info).toBeFocused()

  // Из пикера: «i» не добавляет упражнение, после закрытия пикер с тем же поиском.
  await page.getByRole('button', { name: 'Добавить упражнение' }).click()
  const picker = page.getByRole('dialog', { name: 'Упражнение' })
  await picker.getByPlaceholder('Поиск по названию…').fill('жим лежа')
  await picker.getByRole('button', { name: 'Как выполнять: Жим лежа со штангой' }).click()
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'закрыть' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(picker).toBeVisible()
  await expect(picker.getByPlaceholder('Поиск по названию…')).toHaveValue('жим лежа')
  await picker.getByRole('button', { name: 'закрыть' }).click()
  await expect(page.locator('.exercise-card')).toHaveCount(1)
})

test('на мобильном обе фазы плие целиком помещаются в область показа', async ({ page, context }) => {
  await page.setViewportSize({ width: 393, height: 793 })
  await context.route(/supabase\.co/, route => route.abort())
  await page.goto('/kachalka-app/')
  const name = 'Приседания плие'
  const user = await page.evaluate(async name => {
    const { seedE2E } = await import('/kachalka-app/src/test/e2eSeed.js')
    const exercise = { id: 'e2e-plie', name, muscle_group: 'ноги', metric: 'weight' }
    const user = await seedE2E({ exercises: [exercise] })
    const { writeDraft } = await import('/kachalka-app/src/lib/draftStore.js')
    writeDraft(`workout_draft_new_${user.id}`, [{ exercise, sets: [{ weight: 10, reps: 5, _k: 's1' }] }])
    return user
  }, name)
  await page.reload()
  await page.getByRole('button', { name: user.name }).click()
  await enterPin(page, user.pin)
  await page.getByRole('button', { name: 'Записать тренировку' }).click()

  for (const preference of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: preference })
    await page.getByRole('button', { name: 'Как выполнять: ' + name }).click()
    const sheet = page.getByRole('dialog', { name })
    if (preference === 'no-preference') {
      await expect(sheet.getByRole('img', { name: /Бёдра опущены/ })).toBeVisible()
      await sheet.getByRole('button', { name: 'Остановить смену кадров' }).click()
    }
    const frames = sheet.locator('.technique-paper img')
    await expect(frames).toHaveCount(2)
    for (const img of await frames.all()) {
      const fits = await img.evaluate(async img => {
        await img.decode()
        const box = img.getBoundingClientRect()
        const paper = img.parentElement.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.top >= paper.top && box.left >= paper.left
          && box.bottom <= paper.bottom + 1 && box.right <= paper.right + 1
          && getComputedStyle(img).objectFit === 'contain'
      })
      expect(fits).toBe(true)
    }
    await sheet.getByRole('button', { name: 'закрыть' }).click()
  }
})
