// Обертка OCR (services/scannerOcr.js). Сам tesseract.js проверяет e2e scanner.spec.js под
// настоящей CSP; здесь — контракт настройки: воркер, ядро и языки берутся только с нашего
// адреса `<base>/ocr/` (CSP не пускает CDN), без blob:-воркера (CSP его режет).
import { afterEach, describe, expect, it, vi } from 'vitest'

const createWorker = vi.fn(async () => ({ id: 'worker' }))
vi.mock('tesseract.js', () => ({ createWorker: (...a) => createWorker(...a) }))
const { createScannerWorker } = await import('./scannerOcr.js')

afterEach(() => { vi.unstubAllGlobals(); createWorker.mockClear() })

describe('createScannerWorker', () => {
  it('английский и русский; все файлы — с нашего /ocr/, без blob-воркера', async () => {
    vi.stubGlobal('location', { href: 'https://x.io/kachalka-app/#/history' })
    const onError = vi.fn()
    expect(await createScannerWorker(onError)).toEqual({ id: 'worker' })
    const [langs, oem, opts] = createWorker.mock.calls[0]
    expect(langs).toEqual(['eng', 'rus'])
    expect(oem).toBe(1)
    const base = new URL(`${import.meta.env.BASE_URL}ocr/`, 'https://x.io/kachalka-app/').href
    expect(opts).toEqual({
      workerPath: `${base}worker.min.js`, corePath: base, langPath: base,
      workerBlobURL: false, errorHandler: onError,
    })
    expect(base.startsWith('https://x.io/')).toBe(true)
  })
})
