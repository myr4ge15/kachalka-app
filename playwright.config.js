// ============================================================================
// Playwright — один smoke-e2e поверх реального приложения (см. e2e/smoke.spec.js).
//
// Зачем: юниты покрывают чистый слой, RTL — отдельные компоненты, но сквозной
// путь «вход → запись тренировки → она на месте после перезагрузки» не проверял
// никто, а ломается он целиком (Dexie/персональная база/маршрутизация экранов).
//
// Особенности:
//  • dev-сервер, а не превью сборки: тест грузит модуль-сид `src/test/e2eSeed.js`
//    динамическим import() прямо у Vite (в прод-бандл сид не попадает);
//  • base '/kachalka-app/' из vite.config.js → он же в baseURL и в url;
//  • ключи Supabase подставляем фиктивные: без них App показывает экран «Нужна
//    настройка» вместо входа. Реальной сети тест не касается (см. spec).
//    process.env перебивает локальный .env — прогон одинаков на машине и в CI.
//  • мобильный вьюпорт: WorkoutScreen смонтирован внутри HistoryScreen, и на
//    десктопе это master-detail — мобильная раскладка проще и ближе к боевому
//    сценарию «телефон в зале».
// ============================================================================
import { defineConfig, devices } from '@playwright/test'

const PORT = 5174
const BASE = `http://127.0.0.1:${PORT}/kachalka-app/`

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],

  webServer: {
    // --host 127.0.0.1 обязателен: по умолчанию vite слушает `localhost`, который
    // на Windows резолвится в ::1 (IPv6), а Playwright опрашивает url по 127.0.0.1 —
    // соединения нет и прогон падает с «Timed out waiting from config.webServer».
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    // Логи vite не прячем: если сервер не поднялся (занятый порт, ошибка конфига),
    // причина видна сразу, а не как голый таймаут.
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: 'https://e2e-offline.supabase.co',
      VITE_SUPABASE_KEY: 'sb_publishable_e2e_offline',
    },
  },
})
