import { describe, expect, it } from 'vitest'
import { clampOffset, clampZoom, coverScale, cropRect, initialCrop, zoomAt, ZOOM_MAX } from './avatarCrop.js'

const G = { w: 1200, h: 800, view: 300 } // горизонтальное фото

describe('avatarCrop', () => {
  it('cover: короткая сторона заполняет окно', () => {
    expect(coverScale(1200, 800, 300)).toBe(300 / 800)
    expect(coverScale(0, 0, 300)).toBe(1)
  })

  it('старт — по центру, видна середина фото, квадрат по короткой стороне', () => {
    const st = initialCrop(G.w, G.h, G.view)
    expect(st.zoom).toBe(1)
    expect(st.y).toBe(0)
    expect(cropRect(st, G)).toEqual({ sx: 200, sy: 0, size: 800 })
  })

  it('край окна не открывается: смещение зажимается', () => {
    expect(clampOffset({ x: 50, y: 50 }, { ...G, zoom: 1 })).toEqual({ x: 0, y: 0 })
    expect(clampOffset({ x: -9999, y: -9999 }, { ...G, zoom: 1 })).toEqual({ x: 300 - 450, y: 0 })
  })

  it('zoom в пределах 1…4', () => {
    expect(clampZoom(0.2)).toBe(1)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
    expect(clampZoom(NaN)).toBe(1)
  })

  it('zoom вокруг центра оставляет центр на месте', () => {
    const st = initialCrop(G.w, G.h, G.view)
    const z = zoomAt(st, 2, G)
    expect(z.zoom).toBe(2)
    const r = cropRect(z, G)
    expect(r.size).toBe(400)
    expect(r.sx + r.size / 2).toBeCloseTo(600)
    expect(r.sy + r.size / 2).toBeCloseTo(400)
  })

  it('zoom вокруг угла и обратно — в границах', () => {
    const z = zoomAt(initialCrop(G.w, G.h, G.view), 3, G, 0, 0)
    const back = zoomAt(z, 1, G, 0, 0)
    const r = cropRect(back, G)
    expect(r.size).toBe(800)
    expect(r.sx).toBeGreaterThanOrEqual(0)
    expect(r.sx + r.size).toBeLessThanOrEqual(G.w)
  })

  it('вертикальное фото: квадрат по ширине', () => {
    const g = { w: 600, h: 1000, view: 300 }
    expect(cropRect(initialCrop(g.w, g.h, g.view), g)).toEqual({ sx: 0, sy: 200, size: 600 })
  })
})
