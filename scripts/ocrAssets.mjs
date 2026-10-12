import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
const folder = name => dirname(require.resolve(`${name}/package.json`))

// Same-origin assets, fetched only when scanner opens. No image upload/CDN.
export function ocrAssets() {
  const files = new Map([
    ['worker.min.js', join(folder('tesseract.js'), 'dist/worker.min.js')],
    ...['', '-simd', '-lstm', '-simd-lstm'].map(s =>
      [`tesseract-core${s}.wasm.js`, join(folder('tesseract.js-core'), `tesseract-core${s}.wasm.js`)]),
    ...['eng', 'rus'].map(lang => [
      `${lang}.traineddata.gz`, join(folder(`@tesseract.js-data/${lang}`), `4.0.0_best_int/${lang}.traineddata.gz`),
    ]),
    ['LICENSE-tesseract.txt', join(folder('tesseract.js'), 'LICENSE.md')],
    ['LICENSE-core.txt', join(folder('tesseract.js-core'), 'LICENSE')],
  ])
  let base = '/'
  return {
    name: 'local-ocr-assets',
    configResolved(config) { base = config.base },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const prefix = `${base}ocr/`
        if (!req.url?.startsWith(prefix)) return next()
        const path = files.get(req.url.slice(prefix.length).split('?')[0])
        if (!path) return next()
        res.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : 'application/octet-stream')
        res.end(readFileSync(path))
      })
    },
    generateBundle() {
      for (const [name, path] of files) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(path) })
    },
  }
}
