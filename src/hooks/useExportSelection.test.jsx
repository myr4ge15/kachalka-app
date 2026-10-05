// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useExportSelection } from './useExportSelection.js'

const items = [{ id: 1 }, { id: 2 }, { id: 3 }]

describe('useExportSelection', () => {
  it('вход/выход из режима выбора сбрасывает отметки', () => {
    const { result } = renderHook(() => useExportSelection(vi.fn()))
    act(() => result.current.toggleSelectMode())
    expect(result.current.selectMode).toBe(true)
    act(() => result.current.togglePick(1))
    expect([...result.current.picked]).toEqual([1])
    act(() => result.current.toggleSelectMode())
    expect(result.current.selectMode).toBe(false)
    expect(result.current.picked.size).toBe(0)
  })

  it('togglePick ставит и снимает; pickAll берет переданный список', () => {
    const { result } = renderHook(() => useExportSelection(vi.fn()))
    act(() => result.current.togglePick(2))
    act(() => result.current.togglePick(2))
    expect(result.current.picked.size).toBe(0)
    act(() => result.current.pickAll(items.slice(0, 2)))
    expect([...result.current.picked]).toEqual([1, 2])
    act(() => result.current.pickAll(undefined))
    expect(result.current.picked.size).toBe(0)
  })

  it('экспорт отдает выбранное из ПЕРЕДАННОГО списка в его порядке и выходит из режима', () => {
    const exportFn = vi.fn()
    const { result } = renderHook(() => useExportSelection(exportFn))
    act(() => result.current.toggleSelectMode())
    act(() => result.current.togglePick(3))
    act(() => result.current.togglePick(1))
    act(() => result.current.exportPicked(items))
    expect(exportFn).toHaveBeenCalledTimes(1)
    expect(exportFn.mock.calls[0][0]).toEqual([{ id: 1 }, { id: 3 }])
    expect(typeof exportFn.mock.calls[0][1]).toBe('string') // версия приложения или 'dev'
    expect(result.current.selectMode).toBe(false)
    expect(result.current.picked.size).toBe(0)
  })

  it('ничего не выбрано (или выбранного нет в списке) — экспорт не зовется, режим остается', () => {
    const exportFn = vi.fn()
    const { result } = renderHook(() => useExportSelection(exportFn))
    act(() => result.current.toggleSelectMode())
    act(() => result.current.exportPicked(items))
    act(() => result.current.togglePick(99))
    act(() => result.current.exportPicked(items))
    expect(exportFn).not.toHaveBeenCalled()
    expect(result.current.selectMode).toBe(true)
  })
})
