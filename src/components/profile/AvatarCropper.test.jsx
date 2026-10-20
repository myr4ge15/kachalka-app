// @vitest-environment jsdom
// Ручная обрезка аватара (покрытие тестами 20.10.2026: было 3 % строк). Геометрию держит
// lib/avatarCrop.test.js; здесь — сам лист: фото открылось → «Готово» отдает прямоугольник в
// пикселях исходника; ползунок и колесо масштабируют, палец двигает; битое фото — ошибка.
// jsdom картинки не грузит — Image подменяем: onload с заданным размером.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AvatarCropper from './AvatarCropper.jsx'

let imageMode = 'ok'
class FakeImage {
  constructor() { this.naturalWidth = 1200; this.naturalHeight = 800 }
  set src(v) {
    this._src = v
    setTimeout(() => (imageMode === 'ok' ? this.onload?.() : this.onerror?.()), 0)
  }
  get src() { return this._src }
}

beforeEach(() => {
  imageMode = 'ok'
  vi.stubGlobal('Image', FakeImage)
  URL.createObjectURL = vi.fn(() => 'blob:avatar')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

const box = () => screen.getByRole('img', { name: 'Область обрезки аватара' })
const done = () => screen.getByRole('button', { name: 'Готово' })

describe('AvatarCropper', () => {
  it('фото открылось — «Готово» отдает квадрат внутри исходника', async () => {
    const onDone = vi.fn()
    render(<AvatarCropper file={new Blob(['x'])} onCancel={vi.fn()} onDone={onDone} />)
    expect(done()).toBeDisabled() // пока не загрузилось
    await waitFor(() => expect(done()).toBeEnabled())
    fireEvent.click(done())
    const [img, rect] = onDone.mock.calls[0]
    expect(img).toBeInstanceOf(FakeImage)
    // { sx, sy, size } — в пикселях исходника 1200×800: квадрат внутри картинки.
    expect(rect.size).toBeGreaterThan(0)
    expect(rect.size).toBeLessThanOrEqual(800) // не больше короткой стороны
    expect(rect.sx).toBeGreaterThanOrEqual(0)
    expect(rect.sy).toBeGreaterThanOrEqual(0)
    expect(rect.sx + rect.size).toBeLessThanOrEqual(1200)
    expect(rect.sy + rect.size).toBeLessThanOrEqual(800)
  })

  it('масштаб ползунком и колесом меняет выбранную область', async () => {
    const onDone = vi.fn()
    render(<AvatarCropper file={new Blob(['x'])} onCancel={vi.fn()} onDone={onDone} />)
    await waitFor(() => expect(done()).toBeEnabled())
    fireEvent.click(done())
    const full = onDone.mock.calls[0][1]
    fireEvent.change(screen.getByRole('slider', { name: 'Масштаб' }), { target: { value: '2' } })
    fireEvent.click(done())
    const zoomed = onDone.mock.calls[1][1]
    expect(JSON.stringify(zoomed)).not.toBe(JSON.stringify(full))
    fireEvent.wheel(box(), { deltaY: 100, clientX: 10, clientY: 10 })
    fireEvent.click(done())
    expect(JSON.stringify(onDone.mock.calls[2][1])).not.toBe(JSON.stringify(zoomed))
  })

  it('палец двигает фото (после приближения — есть куда)', async () => {
    const onDone = vi.fn()
    render(<AvatarCropper file={new Blob(['x'])} onCancel={vi.fn()} onDone={onDone} />)
    await waitFor(() => expect(done()).toBeEnabled())
    fireEvent.change(screen.getByRole('slider', { name: 'Масштаб' }), { target: { value: '2' } })
    fireEvent.click(done())
    const before = onDone.mock.calls[0][1]
    fireEvent.pointerDown(box(), { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(box(), { pointerId: 1, clientX: 140, clientY: 120 })
    fireEvent.pointerUp(box(), { pointerId: 1 })
    fireEvent.click(done())
    expect(JSON.stringify(onDone.mock.calls[1][1])).not.toBe(JSON.stringify(before))
  })

  it('битое фото — ошибка, «Готово» недоступна; «Отмена» зовет onCancel', async () => {
    imageMode = 'error'
    const onCancel = vi.fn()
    render(<AvatarCropper file={new Blob(['x'])} onCancel={onCancel} onDone={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось прочитать изображение')
    expect(done()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('идет загрузка — «Загружаю…», кнопки заблокированы', async () => {
    render(<AvatarCropper file={new Blob(['x'])} busy onCancel={vi.fn()} onDone={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Загружаю…' })).toBeDisabled())
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})
