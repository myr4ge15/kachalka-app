// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FeedbackPhotos from './FeedbackPhotos.jsx'

describe('FeedbackPhotos', () => {
  it('грузит все картинки, пока грузятся — заглушки; тап открывает на весь экран', async () => {
    let finish
    const load = vi.fn((id, kind, n) => (n === 0 ? new Promise((r) => { finish = () => r('blob:0') }) : Promise.resolve(`blob:${n}`)))
    render(<FeedbackPhotos id="f1" count={2} load={load} label="Фото" />)
    expect(load.mock.calls).toEqual([['f1', 'reply', 0], ['f1', 'reply', 1]])
    expect(screen.getAllByLabelText('Загрузка')).toHaveLength(2)
    await screen.findByRole('button', { name: 'Фото 2 из 2' })
    expect(screen.getAllByLabelText('Загрузка')).toHaveLength(1) // первая еще грузится
    finish()
    fireEvent.click(await screen.findByRole('button', { name: 'Фото 1 из 2' }))
    expect(screen.getByRole('dialog', { name: 'Фото' }).querySelector('img')).toHaveAttribute('src', 'blob:0')
  })

  it('недоступная картинка (бота пересоздали, нет сети) — честная плашка', async () => {
    render(<FeedbackPhotos id="f1" kind="shot" load={() => Promise.reject(new Error('404'))} label="Скриншот" />)
    expect(await screen.findByRole('img', { name: 'Картинка недоступна' })).toBeInTheDocument()
  })

  it('lazy: до нажатия ничего не качает; disabled офлайн', async () => {
    const load = vi.fn(async () => 'blob:s')
    const { rerender } = render(<FeedbackPhotos id="f1" kind="shot" load={load} lazy disabled label="Скриншот" />)
    expect(screen.getByRole('button', { name: '📎 Показать скриншот' })).toBeDisabled()
    rerender(<FeedbackPhotos id="f1" kind="shot" load={load} lazy label="Скриншот" />)
    expect(load).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '📎 Показать скриншот' }))
    await waitFor(() => expect(load).toHaveBeenCalledWith('f1', 'shot', 0))
    expect(await screen.findByRole('button', { name: 'Скриншот' })).toBeInTheDocument()
  })

  it('просмотр закрывается свайпом вверх; короткое движение — нет', async () => {
    render(<FeedbackPhotos id="f1" load={async () => 'blob:1'} label="Фото" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Фото' }))
    const img = screen.getByRole('dialog', { name: 'Фото' }).querySelector('img')
    const touch = (y) => ({ touches: [{ clientX: 100, clientY: y }], changedTouches: [{ clientX: 100, clientY: y }] })
    fireEvent.touchStart(img, touch(400))
    fireEvent.touchMove(img, touch(380))
    fireEvent.touchEnd(img, { changedTouches: [{ clientX: 100, clientY: 390 }] })
    expect(screen.getByRole('dialog', { name: 'Фото' })).toBeInTheDocument()
    fireEvent.touchStart(img, touch(400))
    fireEvent.touchMove(img, touch(250))
    fireEvent.touchEnd(img, { changedTouches: [{ clientX: 100, clientY: 250 }] })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('нет картинок — ничего', () => {
    const { container } = render(<FeedbackPhotos id="f1" count={0} load={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
