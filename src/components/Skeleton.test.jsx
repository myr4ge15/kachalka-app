// @vitest-environment jsdom
// Чисто презентационные заглушки и иконка: один файл, только контракт
// (размеры в px/строкой, скрытие от скринридера, озвучка загрузки).
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Skeleton from './Skeleton.jsx'
import CardsSkeleton from './CardsSkeleton.jsx'
import ScreenSkeleton from './ScreenSkeleton.jsx'
import PencilIcon from './PencilIcon.jsx'

describe('Skeleton', () => {
  it('число → px, строка — как есть; чужой style сохраняется; скрыт от скринридера', () => {
    const { container } = render(<Skeleton w="60%" h={14} r={7} className="x" style={{ opacity: 0.5 }} />)
    const el = container.firstChild
    expect(el).toHaveClass('skel', 'x')
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el.style.width).toBe('60%')
    expect(el.style.height).toBe('14px')
    expect(el.style.borderRadius).toBe('7px')
    expect(el.style.opacity).toBe('0.5')
  })

  it('без размеров — без инлайн-размеров, класс без хвостового пробела', () => {
    const el = render(<Skeleton />).container.firstChild
    expect(el.getAttribute('class')).toBe('skel')
    expect(el.getAttribute('style')).toBeNull()
  })
})

describe('каркасы загрузки', () => {
  it('CardsSkeleton: N плашек заданной высоты, озвучивается как загрузка', () => {
    render(<CardsSkeleton cards={2} height={50} />)
    const box = screen.getByLabelText('Загрузка')
    expect(box).toHaveAttribute('aria-busy', 'true')
    const plates = box.querySelectorAll('.skel')
    expect(plates).toHaveLength(2)
    expect(plates[0].style.height).toBe('50px')
  })

  it('ScreenSkeleton: заголовок + 4 карточки по умолчанию', () => {
    render(<ScreenSkeleton />)
    const box = screen.getByLabelText('Загрузка')
    expect(box).toHaveClass('screen')
    expect(box.querySelectorAll('.skel-title')).toHaveLength(1)
    expect(box.querySelectorAll('.skel-cards .skel')).toHaveLength(4)
  })
})

describe('PencilIcon', () => {
  it('размер и класс настраиваются, иконка декоративная', () => {
    const svg = render(<PencilIcon size={20} className="ico" />).container.firstChild
    expect(svg).toHaveAttribute('width', '20')
    expect(svg).toHaveClass('ico')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.getAttribute('stroke')).toBe('currentColor') // цвет — от текста, без хардкода
  })
})
