import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'
import { build } from 'vite'

const base = '/kachalka-app/'
const builds = ['1', '2']
const dist = resolve('dist', 'pwa-e2e')
process.env.VITE_APP_BASE = base
process.env.VITE_BETA = '1'
process.env.VITE_HAWK_TOKEN = ''
for (const version of builds) {
  process.env.VITE_BETA_BUILD = version
  await build({ build: { outDir: resolve(dist, version), emptyOutDir: true } })
}

const contentTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm',
}
let deployed = builds[0]
createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1')
  if (pathname === '/deploy-update' && req.method === 'POST') {
    deployed = builds[1]
    res.writeHead(204).end()
    return
  }
  const root = resolve(dist, deployed)
  const file = resolve(root, pathname.slice(base.length) || 'index.html')
  if (!pathname.startsWith(base) || !file.startsWith(root + sep)) {
    res.writeHead(404).end()
    return
  }
  try {
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data)
  } catch {
    res.writeHead(404).end()
  }
}).listen(5175, '127.0.0.1')
