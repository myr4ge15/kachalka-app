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
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Gym Journal',
        short_name: 'Gym',
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
