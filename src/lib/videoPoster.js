// Кадр видео для миниатюры вложения (20.10.2026): iPhone в установленном приложении часто не
// рисует кадр у <video preload="metadata"> — вместо миниатюры был черный квадрат. Здесь кадр
// снимаем сами: грузим файл в невидимый <video>, перематываем на `at` секунд и рисуем на canvas.
// Не вышло за timeout (формат не декодируется, браузер не дал кадр) — null: покажем плашку.
// DOM приходит параметром — для тестов.
export function videoPoster(file, { at = 0.1, timeout = 4000, maxSide = 360, doc = globalThis.document, url = globalThis.URL } = {}) {
  return new Promise((resolve) => {
    if (!file || !doc || !url?.createObjectURL) { resolve(null); return }
    const src = url.createObjectURL(file)
    const v = doc.createElement('video')
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      v.removeAttribute('src')
      try { v.load?.() } catch { /* уже выгружен */ }
      url.revokeObjectURL?.(src)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeout)
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.addEventListener('error', () => finish(null))
    v.addEventListener('loadeddata', () => {
      try { v.currentTime = Math.min(at, Math.max(0, (v.duration || at) - 0.05)) } catch { finish(null) }
    })
    v.addEventListener('seeked', () => {
      try {
        const w = v.videoWidth, h = v.videoHeight
        if (!w || !h) { finish(null); return }
        const k = Math.min(1, maxSide / Math.max(w, h))
        const c = doc.createElement('canvas')
        c.width = Math.round(w * k)
        c.height = Math.round(h * k)
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        finish(c.toDataURL('image/jpeg', 0.7))
      } catch {
        finish(null)
      }
    })
    v.src = src
  })
}
