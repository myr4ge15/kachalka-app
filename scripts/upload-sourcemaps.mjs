// Hawk /release: multipart file + release, авторизация интеграционным токеном.
// CI удаляет карты до публикации, даже если загрузка не удалась.
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { parseHawkToken, collectorUrl } from '../src/lib/errorReport.js'

export async function uploadSourceMaps({ token, buildDir = 'dist', base = '/', fetchFn = fetch }) {
  const parsed = parseHawkToken(token)
  if (!parsed) throw new Error('Не задан корректный VITE_HAWK_TOKEN')
  const { version } = JSON.parse(await readFile(path.join(buildDir, 'version.json'), 'utf8'))
  const assets = path.join(buildDir, 'assets')
  const files = (await readdir(assets)).filter((name) => name.endsWith('.js.map'))
  if (!files.length) throw new Error('Не найдены source maps: нужна сборка HAWK_SOURCEMAPS=1')
  for (const name of files) {
    const form = new FormData()
    form.append('release', version)
    form.append('file', new Blob([await readFile(path.join(assets, name))]), `${base.replace(/\/$/, '')}/assets/${name}`)
    const response = await fetchFn(`${collectorUrl(parsed)}/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    // Ответ может содержать секрет: в логи выводим только статус и общий текст.
    if (!response.ok) throw new Error(`Hawk source maps: HTTP ${response.status}`)
    const result = await response.json()
    if (result.error !== false) throw new Error('Hawk не подтвердил прием source map')
  }
  return files.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = await uploadSourceMaps({
      token: process.env.VITE_HAWK_TOKEN,
      buildDir: process.env.BUILD_DIR || 'dist',
      base: process.env.APP_BASE || '/',
    })
    console.log(`Source maps в Hawk: ${count} файлов.`)
  } catch {
    console.error('Не удалось загрузить source maps в Hawk. Проверьте токен и доступность сервиса.')
    process.exitCode = 1
  }
}
