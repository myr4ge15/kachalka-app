import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Проверяем уже упакованные сборки: новый SW не должен захватить лендинг,
// а старая сборка должна остаться работоспособной на прежнем Pages-пути.
const root = process.argv[2] || 'dist'
for (const [dir, base] of [[root, '/kachalka-app/'], [join(root, 'app'), '/app/']]) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8'))
  const url = `https://example.test${base}manifest.webmanifest`
  assert.equal(new URL(manifest.scope, url).pathname, base, `${dir}: scope`)
  assert.equal(new URL(manifest.start_url, url).pathname, base, `${dir}: start_url`)
  assert.ok(html.includes(`src="${base}assets/`), `${dir}: script base`)
  assert.ok(html.includes(`href="${base}assets/`), `${dir}: CSS base`)
  const files = readdirSync(dir, { recursive: true }).map(String)
  assert.ok(!files.some((f) => f.endsWith('.map')), `${dir}: публичные source maps`)
  const js = files.filter((f) => f.startsWith('assets') && f.endsWith('.js'))
    .map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
  assert.ok(js.includes(`${base}sw.js`), `${dir}: service worker URL`)
  assert.ok(readFileSync(join(dir, 'sw.js'), 'utf8').includes('index.html'), `${dir}: SW navigation`)
  assert.equal(JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')).version,
    JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')).version, `${dir}: версия`)
}
console.log('Обе сборки: пути, manifest, SW, версия и отсутствие .map — OK')
