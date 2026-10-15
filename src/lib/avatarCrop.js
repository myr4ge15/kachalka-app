// Ручная обрезка аватара (15.10.2026) — чистая геометрия, без DOM.
//
// Окно — квадрат view×view (CSS px). Картинка w×h показана с масштабом
// s = cover × zoom, где cover = view / min(w, h) (при zoom = 1 короткая сторона ровно
// заполняет окно). Положение — левый верхний угол картинки (x, y) относительно окна;
// картинка всегда покрывает окно целиком: view − w·s ≤ x ≤ 0 (и так же по y).

export const ZOOM_MIN = 1
export const ZOOM_MAX = 4

export function coverScale(w, h, view) {
  const short = Math.min(w, h)
  return short > 0 ? view / short : 1
}

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function clampZoom(z) {
  return clampNum(Number.isFinite(z) ? z : ZOOM_MIN, ZOOM_MIN, ZOOM_MAX)
}

// Не дать картинке уехать и открыть пустой край окна.
export function clampOffset({ x, y }, { w, h, view, zoom }) {
  const s = coverScale(w, h, view) * clampZoom(zoom)
  return {
    x: clampNum(x, Math.min(0, view - w * s), 0),
    y: clampNum(y, Math.min(0, view - h * s), 0),
  }
}

// Стартовое положение: картинка по центру окна, zoom = 1.
export function initialCrop(w, h, view) {
  const s = coverScale(w, h, view)
  return { zoom: 1, x: (view - w * s) / 2, y: (view - h * s) / 2 }
}

// Новый zoom с неподвижной точкой (fx, fy) окна (центр — для ползунка, середина пальцев —
// для щипка). Возвращает { zoom, x, y } уже в границах.
export function zoomAt(state, nextZoom, { w, h, view }, fx = view / 2, fy = view / 2) {
  const zoom = clampZoom(nextZoom)
  const s0 = coverScale(w, h, view) * clampZoom(state.zoom)
  const s1 = coverScale(w, h, view) * zoom
  const px = (fx - state.x) / s0
  const py = (fy - state.y) / s0
  return { zoom, ...clampOffset({ x: fx - px * s1, y: fy - py * s1 }, { w, h, view, zoom }) }
}

// Какой квадрат исходной картинки (в ее пикселях) виден в окне.
export function cropRect(state, { w, h, view }) {
  const { x, y } = clampOffset(state, { w, h, view, zoom: state.zoom })
  const s = coverScale(w, h, view) * clampZoom(state.zoom)
  const size = Math.min(view / s, w, h)
  return {
    sx: clampNum(-x / s, 0, w - size),
    sy: clampNum(-y / s, 0, h - size),
    size,
  }
}
