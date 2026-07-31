// ============================================================================
// Smoke-e2e: единственный сквозной путь, ради которого приложение существует —
// «вход → записать тренировку → она в истории после перезагрузки».
//
// Ловит регрессии, которых не видят юниты и RTL: открытие персональной Dexie на
// входе, монтирование WorkoutScreen внутри HistoryScreen, сохранение через repo
// + очередь, чтение истории из локальной базы после полного рестарта страницы.
//
// Сеть НЕ участвует: navigator.onLine подменён на false (LoginScreen уходит в
// ветку офлайн-сверки PIN, синк не стартует), а любые запросы к supabase.co
// режутся route'ом. Локальное состояние «устройство уже входило» раскладывает
// src/test/e2eSeed.js (грузится в странице через vite dev-сервер).
// ============================================================================
import { test, expect } from '@playwright/test'

const APP = '/kachalka-app/'
const EXERCISE = 'Жим лёжа (e2e)'
const SECOND_EXERCISE = 'Подтягивания (e2e)'

test('вход → запись тренировки → она в истории после перезагрузки', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false, configurable: true })
  })
  await context.route(/supabase\.co/, (route) => route.abort())

  // Первый заход — только чтобы получить страницу с origin'ом (IndexedDB, модули).
  await page.goto(APP)
  const user = await page.evaluate(async () => {
    const seed = await import('/kachalka-app/src/test/e2eSeed.js')
    return seed.seedE2E()
  })
  await page.reload()

  // --- вход по PIN (офлайн-ветка) ------------------------------------------
  await page.getByRole('button', { name: user.name }).click()
  for (const digit of user.pin) {
    await page.locator('.keypad .key', { hasText: new RegExp(`^${digit}$`) }).click()
  }
  await expect(page.locator('.tabbar')).toBeVisible()

  // Исторический подход нужен, чтобы новая запись действительно побила PR и
  // сквозной тест проверил главное событие finish-sheet + переход в Прогресс.
  await page.evaluate(async (userId) => {
    const [{ saveWorkout }, { E2E_EXERCISES }] = await Promise.all([
      import('/kachalka-app/src/db/repo.js'),
      import('/kachalka-app/src/test/e2eSeed.js'),
    ])
    await saveWorkout({
      user_id: userId,
      performed_at: '2026-06-01T12:00:00.000Z',
      entries: [{
        exercise: E2E_EXERCISES[0],
        sets: [{ weight: 50, reps: 8 }],
      }],
    })
  }, user.id)

  // --- запись тренировки ----------------------------------------------------
  await page.locator('.tabbar .tab').filter({ hasText: 'Тренировки' }).click()
  
  // ИСПРАВЛЕНИЕ: На мобильном вьюпорте (390x844) используется плавающая 
  // кнопка «+» (FAB). Десктопная кнопка «+ Добавить тренировку» скрыта.
  await page.locator('.fab').click()
  
  await page.getByRole('button', { name: '+ Добавить упражнение' }).click()
  await page.locator('.picker-item').filter({ hasText: EXERCISE }).click()

  // Второе добавленное упражнение становится активным, первое компактно
  // сворачивается. Тап по сводке возвращает первое без потери значений/состава.
  await page.getByRole('button', { name: '+ Добавить упражнение' }).click()
  await page.locator('.picker-item').filter({ hasText: SECOND_EXERCISE }).click()
  await expect(page.locator('.exercise-card--active')).toContainText(SECOND_EXERCISE)
  await expect(page.locator('.exercise-card--compact')).toContainText(EXERCISE)

  const pullupSet = page.locator('.exercise-card--active .set-row')
  await pullupSet.locator('input').fill('10')

  await page.locator('.exercise-card--compact .exercise-compact-toggle').click()
  await expect(page.locator('.exercise-card--active')).toContainText(EXERCISE)
  await expect(page.locator('.exercise-card--compact')).toContainText(SECOND_EXERCISE)
  await expect.poll(async () => page.locator('.exercise-card--active').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    return Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2)
  })).toBeLessThan(140)

  const benchSet = page.locator('.exercise-card--active .set-row')
  await benchSet.locator('input').first().fill('60')   // вес
  await benchSet.locator('input').nth(1).fill('8')     // повторы

  await page.locator('.save-btn').click()

  // Локальное сохранение сразу показывает итог поверх Истории — сеть выключена.
  await expect(page.getByRole('dialog', { name: 'Тренировка готова' })).toBeVisible()
  await expect(page.getByText('Упражнения').locator('..')).toContainText('2')
  await expect(page.getByText('Подходы').locator('..')).toContainText('2')
  await expect(page.getByText('Тоннаж').locator('..')).toContainText('480 кг')
  await expect(page.getByText('Новый рекорд!')).toBeVisible()
  await page.getByRole('button', { name: '📋 Сохранить как шаблон' }).click()
  await expect(page.locator('.workout-finish-template-msg')).toContainText('Шаблон «Тренировка')
  await page.getByRole('button', { name: 'Посмотреть прогресс' }).click()
  await expect(page.locator('.prog-select')).toHaveValue('e2e-ex-bench')
  await page.locator('.tabbar .tab').filter({ hasText: 'Тренировки' }).click()

  // Переход из итога закрыл sheet; тренировка в списке на месте.
  const card = page.locator('.history-card').first()
  await expect(card).toContainText(EXERCISE)
  await expect(card).toContainText('60×8')
  await expect(card).toContainText(SECOND_EXERCISE)
  await expect(card).toContainText('10')

  // --- перезагрузка: данные пережили рестарт (читаются из локальной Dexie) ---
  await page.reload()
  await page.locator('.tabbar .tab').filter({ hasText: 'Тренировки' }).click()

  const afterReload = page.locator('.history-card').first()
  await expect(afterReload).toContainText(EXERCISE)
  await expect(afterReload).toContainText('60×8')
  await expect(afterReload).toContainText(SECOND_EXERCISE)
  await expect(afterReload).toContainText('2 упр · 2 подх.')

  // Переход из длинного Профиля по личному рекорду открывает выбранное
  // упражнение и после commit ставит общий .content в начало, а не наследует
  // нижнюю позицию предыдущего экрана.
  await page.getByRole('button', { name: 'Открыть профиль' }).click()
  const content = page.locator('.content')
  await content.evaluate((node) => { node.scrollTop = node.scrollHeight })
  await page.locator('.pr-row').filter({ hasText: EXERCISE }).click()
  await expect(page.locator('.prog-select')).toHaveValue('e2e-ex-bench')
  await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBeLessThan(5)
  await page.locator('.tabbar .tab').filter({ hasText: 'Тренировки' }).click()

  // Липкая «Сохранить» не должна зависеть от фазы анимации входа экрана: пока
  // .screen-anim анимировала transform, обёртка на ~180мс становилась containing
  // block для position:fixed, и бар всплывал в центр, а потом прыгал к низу
  // вьюпорта (видно при переходе «Главная» → новая тренировка, где меняется
  // key={tab}). Замедляем анимацию, чтобы замер гарантированно попал в её середину,
  // а не гонялся с длительностью. Проверяем ДО перехода на десктопный вьюпорт —
  // там бар уже в потоке (position: static в master-detail).
  await page.addStyleTag({ content: '.screen-anim { animation-duration: 5s !important; }' })
  await page.locator('.tabbar .tab').filter({ hasText: 'Главная' }).click()
  await page.locator('.fab').click()
  const saveBar = page.locator('.wk-save-bar')
  await expect(saveBar).toBeVisible()
  const gapFromBottom = await saveBar.evaluate(
    (node) => window.innerHeight - node.getBoundingClientRect().bottom
  )
  expect(gapFromBottom).toBeLessThan(120) // ≈72px над таббаром, а не «в центре»
  await page.locator('.tabbar .tab').filter({ hasText: 'Тренировки' }).click()

  // Desktop master-detail: список остаётся слева, справа открывается тот же
  // focus-композер с одной активной и одной компактной карточкой.
  await page.setViewportSize({ width: 1200, height: 900 })
  await afterReload.click()
  await expect(page.locator('.md-list-col')).toBeVisible()
  await expect(page.locator('.exercise-card--active')).toContainText(EXERCISE)
  await expect(page.locator('.exercise-card--compact')).toContainText(SECOND_EXERCISE)

  // Повторное сохранение существующей записи — тихий возврат к списку: итоговый
  // шит принадлежит завершению занятия, а не правке старой записи (v5.12.3).
  await page.locator('.save-btn').click()
  await expect(page.getByRole('dialog', { name: 'Тренировка готова' })).toHaveCount(0)
  await expect(page.locator('.history-card').first()).toContainText('2 упр · 2 подх.')

  // --- зоны тапа отметок выполнения (геометрия, юнитам не видна) -------------
  // Отметки соседних подходов не имеют права делить межстрочный зазор: раздутая
  // на ±4px невидимая зона смыкалась встык с соседней, и тап чуть выше отметки N
  // снимал галочку с N−1 — молча и не там, куда целились. Ничего не сохраняем,
  // это последний шаг сценария.
  await page.locator('.history-card').first().click()
  await page.getByRole('button', { name: '+ подход (повтор предыдущего)' }).click()
  const marks = page.locator('.exercise-card--active .set-done')
  await expect(marks).toHaveCount(2)
  const hits = await marks.nth(1).evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const at = (dy) => {
      const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + dy)
      const mark = el?.closest?.('.set-done')
      return mark ? [...document.querySelectorAll('.set-done')].indexOf(mark) : null
    }
    // Над отметкой второго подхода — либо она сама, либо ничьё пространство.
    return [at(-6), at(-2), at(rect.height / 2)]
  })
  expect(hits).toEqual([null, null, 1])
})
