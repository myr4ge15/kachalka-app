// У уже открытой вкладки ещё старый HTML. Оставляем в следующем деплое
// хешированные файлы только одной предыдущей версии, не включая их в новый SW.
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePrecacheManifest } from '../src/lib/launchUpdate.js'

export async function retainBetaAssets(origin, dist, request = fetch) {
  const get = path => request(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(20000) })
  const manifest = await get('/sw.js')
  if (manifest.status === 404) return 0
  if (!manifest.ok) throw Error('Не удалось получить предыдущий sw.js: ' + manifest.status)
  const files = new Set(parsePrecacheManifest(await manifest.text()).map(e => e.url.replace(/^\.?\//u, ''))
    .filter(path => /^assets\/[\w.-]+-[\w-]{6,}\.(?:js|css)$/u.test(path)))
  let saved = 0
  async function retain(path) {
    const file = join(dist, path)
    try { await access(file); return } catch (err) { if (err.code !== 'ENOENT') throw err }
    const res = await get('/' + path)
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !(path.endsWith('.css') ? /text\/css/i : /javascript|ecmascript/i).test(type)) {
      throw Error('Предыдущая сборка не отдала ' + path + ' (' + res.status + ', ' + type + ')')
    }
    await writeFile(file, new Uint8Array(await res.arrayBuffer()), { flag: 'wx' })
    saved++
  }
  const paths = [...files]
  for (let i = 0; i < paths.length; i += 6) await Promise.all(paths.slice(i, i + 6).map(retain))
  return saved
}
