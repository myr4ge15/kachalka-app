export async function createScannerWorker(errorHandler) {
  const { createWorker } = await import('tesseract.js')
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href
  return createWorker(['eng', 'rus'], 1, {
    workerPath: `${base}worker.min.js`, corePath: base, langPath: base,
    workerBlobURL: false, errorHandler,
  })
}
