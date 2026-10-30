// Страница «Быстрый старт» лендинга: собирает landing/quick-start/index.html из docs/quick-start.md
// тем же разбором, что и лист в приложении (lib/miniMarkdown.js). Запуск: node scripts/quick-start-page.mjs
// Правится только документ, а страница пересобирается и выкладывается вместе с лендингом.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { inlineParts, parseMarkdown } from '../src/lib/miniMarkdown.js'

const APP_URL = 'https://myr4ge15.github.io/kachalka-app/'
const OUT_DIR = 'landing/quick-start'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const code = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')
const inline = (text) => inlineParts(text).map((p) => (p.bold ? `<strong>${code(p.text)}</strong>` : code(p.text))).join('')
const plain = (text) => inlineParts(text).map((p) => p.text).join('').replace(/`/g, '')

const blocks = parseMarkdown(readFileSync('docs/quick-start.md', 'utf8'))
const lead = blocks.find((b) => b.type === 'p')
const toc = []
const body = blocks.filter((b) => b !== lead && !(b.type === 'h' && b.level === 1) && b.type !== 'hr').map((b) => {
  if (b.type === 'h' && b.level === 2) {
    const id = `s${toc.length + 1}`
    toc.push({ id, text: plain(b.text) })
    return `<h2 id="${id}">${inline(b.text)}</h2>`
  }
  if (b.type === 'h') return `<h3>${inline(b.text)}</h3>`
  if (b.type === 'quote') return `<blockquote>${inline(b.text)}</blockquote>`
  if (b.type === 'ul' || b.type === 'ol') return `<${b.type}>${b.items.map((t) => `<li>${inline(t)}</li>`).join('')}</${b.type}>`
  return `<p>${inline(b.text)}</p>`
}).join('\n          ')

const links = toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('\n              ')

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <!-- Страница собрана из docs/quick-start.md, руками не править: node scripts/quick-start-page.mjs -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'">
  <title>Быстрый старт — kachalka-app</title>
  <meta name="description" content="${esc(plain(lead.text))}">
  <meta name="theme-color" content="#111827">
  <link rel="canonical" href="https://kachalka-app.ru/quick-start/">
  <link rel="icon" type="image/svg+xml" href="../favicon.svg">
  <link rel="icon" type="image/png" sizes="192x192" href="../icon-192.png">
  <link rel="apple-touch-icon" href="../apple-touch-icon.png">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:url" content="https://kachalka-app.ru/quick-start/">
  <meta property="og:title" content="Быстрый старт — kachalka-app">
  <meta property="og:description" content="${esc(plain(lead.text))}">
  <meta property="og:image" content="https://kachalka-app.ru/og.png">
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <a class="skip" href="#main">К содержанию</a>

  <header class="top">
    <div class="wrap top-row">
      <a class="brand" href="../" aria-label="kachalka-app, на главную">
        <img src="../favicon.svg" width="36" height="36" alt="">
        <span>kachalka-app</span>
      </a>
      <nav class="top-nav" aria-label="Разделы сайта">
        <a href="../#features">Что умеет</a>
        <a href="../#friends">С друзьями</a>
        <a href="../#access">Как попасть</a>
        <a href="./" aria-current="page">Быстрый старт</a>
      </nav>
      <a class="btn btn--sm js-app" href="${APP_URL}">Войти</a>
    </div>
  </header>

  <main id="main" class="doc-page">
    <div class="wrap">
      <header class="doc-head">
        <h1>Быстрый старт</h1>
        <p class="section-lead">${inline(lead.text)}</p>
      </header>
      <div class="doc-grid">
        <aside class="toc-side">
          <nav aria-label="Содержание">
            <ol>
              ${links}
            </ol>
          </nav>
        </aside>
        <div class="doc">
          <details class="toc-fold">
            <summary>Содержание</summary>
            <nav aria-label="Содержание">
              <ol>
                ${links}
              </ol>
            </nav>
          </details>
          ${body}
          <div class="final">
            <p class="final-title">Пора в зал</p>
            <a class="btn js-app" href="${APP_URL}">Открыть приложение</a>
          </div>
        </div>
      </div>
    </div>
  </main>

  <footer class="foot">
    <div class="wrap foot-row">
      <span>kachalka-app</span>
      <a href="../">На главную</a>
    </div>
  </footer>
</body>
</html>
`

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(`${OUT_DIR}/index.html`, html)
console.log(`${OUT_DIR}/index.html: ${toc.length} разделов`)
