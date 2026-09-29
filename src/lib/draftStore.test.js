// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { readDraft, writeDraft, clearDraft, resetDraftMemory } from './draftStore.js'

beforeEach(() => {
  resetDraftMemory()
  localStorage.clear()
})

describe('draftStore', () => {
  it('пишет черновик на диск и поднимает его после сброса памяти (перезапуск)', () => {
    writeDraft('workout_draft_new_u1', [{ exercise: { id: 'bench' }, sets: [{ weight: 60, reps: 8 }] }])
    resetDraftMemory()
    expect(readDraft('workout_draft_new_u1')).toEqual([
      { exercise: { id: 'bench' }, sets: [{ weight: 60, reps: 8 }] },
    ])
  })

  it('пустое значение на диске не держит', () => {
    writeDraft('k', ['x'])
    writeDraft('k', [])
    expect(localStorage.getItem('gym_app_k')).toBeNull()
    writeDraft('f', {})
    expect(localStorage.getItem('gym_app_f')).toBeNull()
  })

  it('clearDraft убирает и память, и диск', () => {
    writeDraft('k', { bench: 'easy' })
    clearDraft('k')
    expect(readDraft('k')).toBeUndefined()
    resetDraftMemory()
    expect(readDraft('k')).toBeUndefined()
  })

  it('битое значение на диске не роняет чтение', () => {
    localStorage.setItem('gym_app_k', '{битый json')
    expect(readDraft('k')).toBeUndefined()
  })

  it('память авторитетна в пределах страницы, даже если диск отстал', () => {
    writeDraft('k', ['новое'])
    localStorage.setItem('gym_app_k', JSON.stringify(['старое']))
    expect(readDraft('k')).toEqual(['новое'])
  })
})
