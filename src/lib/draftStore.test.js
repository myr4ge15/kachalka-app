// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readDraft, writeDraft, clearDraft, resetDraftMemory, hasWorkoutDrafts } from './draftStore.js'

beforeEach(() => {
  resetDraftMemory()
  localStorage.clear()
})

describe('draftStore', () => {
  it('переезд учитывает новые и редактируемые черновики своей учетки, включая память', () => {
    writeDraft('workout_draft_new_other', ['x'])
    expect(hasWorkoutDrafts('u1')).toBe(false)
    writeDraft('workout_draft_new_u1', ['x'])
    localStorage.removeItem('gym_app_workout_draft_new_u1')
    expect(hasWorkoutDrafts('u1')).toBe(true)
    clearDraft('workout_draft_new_u1')
    localStorage.setItem('gym_app_workout_edit_u1_w1', JSON.stringify({ entries: ['x'] }))
    expect(hasWorkoutDrafts('u1')).toBe(true)
    clearDraft('workout_edit_u1_w1')
    writeDraft('workout_draft_new_u1', [])
    expect(hasWorkoutDrafts('u1')).toBe(false)
  })
  it('битый черновик не считается подтверждением сохранности', () => {
    localStorage.setItem('gym_app_workout_edit_u1_w1', '{broken')
    expect(() => hasWorkoutDrafts('u1')).toThrow()
  })
  it('недоступное хранилище не считается пустым', () => {
    vi.stubGlobal('localStorage', null)
    try { expect(() => hasWorkoutDrafts('u1')).toThrow(/черновики/) }
    finally { vi.unstubAllGlobals() }
  })
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
