// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createPhaseSortLayout } from './phaseSortLayout.js'

it('заголовки и место вставки следуют будущему порядку, отмена возвращает исходный', () => {
  const root = document.createElement('div')
  root.innerHTML = '<p data-sort-phase="warmup"></p><div id="w"></div>' +
    '<p data-sort-phase="main"></p><div id="a"></div><div id="b"></div>' +
    '<p data-sort-phase="cooldown"></p><div id="c"></div>'
  const rows = [...root.querySelectorAll('div')]
  const layout = createPhaseSortLayout(root, rows, el => el.id)
  const visibleOrder = () => [...root.children].filter(el => !el.hidden)
    .sort((a, b) => Number(a.style.order) - Number(b.style.order)).map(el => el.id || el.dataset.sortPhase)
  const original = visibleOrder()
  layout.preview('a', 'c')
  expect(visibleOrder()).toEqual(['warmup', 'w', 'main', 'b', 'a', 'cooldown', 'c'])
  layout.preview('c', 'a')
  expect(visibleOrder()).toEqual(['warmup', 'w', 'main', 'c', 'a', 'b'])
  layout.preview('c', undefined)
  expect(visibleOrder()).toEqual(original)
  layout.preview('a', null)
  expect(visibleOrder()).toEqual(['warmup', 'w', 'main', 'b', 'cooldown', 'c', 'a'])
  layout.reset()
  expect(visibleOrder()).toEqual(original)
})

it('если остается только основная часть, ее заголовок тоже скрывается', () => {
  const root = document.createElement('div')
  root.innerHTML = '<p data-sort-phase="warmup"></p><div id="w"></div>' +
    '<p data-sort-phase="main"></p><div id="a"></div><div id="b"></div>'
  const layout = createPhaseSortLayout(root, [...root.querySelectorAll('div')], el => el.id)
  layout.preview('w', 'b')
  expect([...root.querySelectorAll('p')].every(el => el.hidden)).toBe(true)
  layout.reset()
  expect(root.querySelector('[hidden]')).toBeNull()
  expect(createPhaseSortLayout(document.createElement('div'), [], el => el.id)).toBeNull()
})
