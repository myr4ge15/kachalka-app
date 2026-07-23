import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// Версия приложения — единый источник правды package.json; показывается внизу
// «Профиля» (см. ProfileScreen). Подставляется на сборке в __APP_VERSION__,
// рантайма не трогает. Читаем через fs, а не `import … assert { type: 'json' }`:
// import-assertion удалён в Node 22+/24 и даёт deprecation-предупреждение.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// base must match your GitHub Pages repo name: '/<repo>/'
export default defineConfig({
  base: '/kachalka-app/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Тест-сьют (Vitest). ДЕФОЛТ окружения — node: чистый слой src/lib и src/db
  // (без UI) гоняется быстро и без DOM, как раньше. Компонентные тесты (RTL)
  // опт-инят в jsdom пофайловым докблоком `// @vitest-environment jsdom` —
  // так node-сьют (55 файлов) не платит за DOM. setupFiles грузит jest-dom
  // матчеры ТОЛЬКО в jsdom (guard внутри). Vitest сам подхватывает этот конфиг,
  // значит тесты видят тот же define __APP_VERSION__, что и сборка.
  // См. docs/plans/PLAN-tests.md.
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['./src/test/setup.js'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      // heic2any (~1.35 МБ) грузится лениво и только онлайн (конверсия HEIC при
      // выборе аватара) — из precache его исключаем, иначе SW тянул бы его всем
      // на установке. На лету подгрузится при необходимости.
      workbox: {
        globIgnores: ['**/heic2any-*.js'],
        // Активированный (после SKIP_WAITING) SW сразу берёт под контроль уже
        // открытые НЕконтролируемые вкладки. Без этого на десктопе первая сессия
        // часто идёт без контроллера → skipWaiting активирует новый SW, но он не
        // «захватывает» страницу, controllerchange не срабатывает и кнопка
        // «Обновить» не перезагружает (нужен был Ctrl+Shift+R). В prompt-режиме
        // claim происходит только ПОСЛЕ явного skipWaiting по нажатию — фоновой
        // подмены версии без спроса нет.
        clientsClaim: true,
        // Аватары лежат в Supabase Storage (кросс-домен, не в precache) — без
        // рантайм-кэша в офлайне они не грузились. CacheFirst: один раз увиденная
        // картинка отдаётся из кэша и работает в авиарежиме. URL меняется при
        // замене (?v=<ts>), так что CacheFirst не залипает на старой версии.
        // ВАЖНО: паттерн заякорен на НАЧАЛО полного URL (включая origin). Для
        // кросс-доменных запросов Workbox матчит RegExp только если он совпадает
        // с началом URL (result.index === 0) — защита от случайных матчей. Прежний
        // паттерн /\/storage\/…\/avatars\// совпадал в СЕРЕДИНЕ (после
        // https://<ref>.supabase.co) → для кросс-домена игнорировался, аватары
        // никогда не кэшировались (онлайн — грузились заново, офлайн — серый кружок).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/avatars\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'avatars',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'kachalka-app',
        short_name: 'kachalka-app',
        description: 'Strength training tracker',
        lang: 'ru',
        theme_color: '#16a34a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  build: {
    // heic2any (~1.35 МБ) — заведомо крупный чанк, но грузится лениво и только
    // онлайн (конверсия HEIC-аватара) и исключён из precache → на старт приложения
    // его размер не влияет. Поднимаем порог предупреждения чуть выше этого чанка,
    // чтобы не заглушать сигнал о реально раздувшихся чанках приложения.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        // Делим вендоров на отдельные кэшируемые чанки, чтобы ни один кусок не
        // превышал лимит и обновление приложения не инвалидировало react/supabase.
        // recharts (только в «Прогрессе») вынесен в свой чанк и грузится лениво.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'charts'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
        }
      }
    }
  }
})
