// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import MuscleMap, { bucketClass, regionOf } from './MuscleMap.jsx'

describe('MuscleMap — чистые хелперы', () => {
  it('bucketClass: известный статус → класс, прочее → «без данных»', () => {
    expect(bucketClass('resting')).toBe('mm-s-resting')
    expect(bucketClass('нечто')).toBe('mm-muscle')
    expect(bucketClass(undefined)).toBe('mm-muscle')
  })
  it('regionOf: подмышца → анатомическая зона', () => {
    expect(regionOf('chest_upper')).toBe('chest')
    expect(regionOf('glute_med')).toBe('gluteal')
    expect(regionOf('нет такой')).toBeNull()
  })
})

describe('MuscleMap', () => {
  it('зона красится по САМОМУ СТРОГОМУ статусу подмышц; без данных — штриховка', () => {
    render(<MuscleMap bySub={{ chest_upper: 'ready', chest_lower: 'resting', biceps: 'stale' }} />)
    const chest = screen.getAllByRole('button', { name: 'грудь' })[0]
    chest.querySelectorAll('path').forEach((p) => expect(p).toHaveClass('mm-part', 'mm-s-resting'))
    const biceps = screen.getAllByRole('button', { name: 'бицепс' })[0]
    expect(biceps.querySelector('path')).toHaveClass('mm-s-stale')
    const calves = screen.getAllByRole('button', { name: 'икры' })[0]
    const p = calves.querySelector('path')
    expect(p.getAttribute('class')).toBe('mm-part')
    expect(p.getAttribute('fill')).toMatch(/^url\(#mm-untracked-(front|back)\)$/)
  })

  it('две фигуры (спереди/сзади) с подписями', () => {
    render(<MuscleMap />)
    expect(screen.getByRole('img', { name: /спереди/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /сзади/ })).toBeInTheDocument()
  })

  it('выбор зоны кликом и с клавиатуры (Enter/пробел); выбранная — aria-pressed', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<MuscleMap onSelect={onSelect} />)
    const chest = screen.getAllByRole('button', { name: 'грудь' })[0]
    fireEvent.click(chest)
    fireEvent.keyDown(chest, { key: 'Enter' })
    fireEvent.keyDown(chest, { key: ' ' })
    fireEvent.keyDown(chest, { key: 'a' })
    expect(onSelect.mock.calls).toEqual([['chest'], ['chest'], ['chest']])
    rerender(<MuscleMap onSelect={onSelect} selected="chest" />)
    expect(screen.getAllByRole('button', { name: 'грудь' })[0]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { name: 'бицепс' })[0]).toHaveAttribute('aria-pressed', 'false')
  })
})
