import { expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retainBetaAssets } from '../../scripts/retain-beta-assets.mjs'

it('сохраняет прежние модули, оставляет новый файл при совпадении и отклоняет HTML', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beta-assets-'))
  const manifest = ['assets/Page-old12345.js', 'assets/Page-current12.css', '../secret-js12345.js', 'assets/a-12345678.js.map']
    .map(path => '{url:"' + path + '",revision:null}').join(',')
  const request = vi.fn(url => Promise.resolve(url.pathname === '/sw.js' ? new Response(manifest) :
    new Response('export default 42', { headers: { 'content-type': 'application/javascript' } })))
  try {
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'assets/Page-current12.css'), 'body{}')
    expect(await retainBetaAssets('https://beta.example', root, request)).toBe(1)
    expect(request.mock.calls.map(([url]) => url.pathname)).toEqual(['/sw.js', '/assets/Page-old12345.js'])
    expect(await readFile(join(root, 'assets/Page-old12345.js'), 'utf8')).toBe('export default 42')
    expect(await readFile(join(root, 'assets/Page-current12.css'), 'utf8')).toBe('body{}')
    const bad = url => Promise.resolve(url.pathname === '/sw.js' ? new Response('{url:"assets/Other-12345678.js",revision:null}') :
      new Response('<html/>', { headers: { 'content-type': 'text/html' } }))
    await expect(retainBetaAssets('https://beta.example', root, bad)).rejects.toThrow(/text\/html/)
  } finally { await rm(root, { recursive: true }) }
})
