import { describe, it, expect } from 'vitest'
import { selectStaleWorkoutIds, reconcileStaleWorkouts } from './pullReconcile.js'
import { cmpIsoAsc } from './cmp.js'

// Точная копия СТАРОЙ, оконной логики реконсиляции удалений (для воспроизведения
// «зазора»). Удаляем локальную чистую запись, только если она в пределах окна:
// старше границы окна — пропускаем (не запрашивали).
function oldWindowedStaleIds(locals, windowIds, justPushed, { partial, boundary }) {
  const server = new Set(windowIds)
  const pushed = new Set(justPushed)
  const stale = []
  for (const w of locals) {
    if (server.has(w.id) || w._dirty || w._deleted) continue
    if (pushed.has(w.id)) continue
    if (partial && cmpIsoAsc(w.performed_at, boundary) < 0) continue
    stale.push(w.id)
  }
  return stale
}

describe('selectStaleWorkoutIds', () => {
  it('удаляет чистую локальную запись, которой нет на сервере', () => {
    const locals = [{ id: 'a', performed_at: '2026-01-01' }]
    expect(selectStaleWorkoutIds(locals, [], [])).toEqual(['a'])
  })

  it('НЕ трогает запись, ещё живущую на сервере', () => {
    const locals = [{ id: 'a', performed_at: '2026-01-01' }]
    expect(selectStaleWorkoutIds(locals, ['a'], [])).toEqual([])
  })

  it('НЕ трогает _dirty и _deleted (несинхрон. правки)', () => {
    const locals = [
      { id: 'a', _dirty: 1 },
      { id: 'b', _deleted: 1 },
    ]
    expect(selectStaleWorkoutIds(locals, [], [])).toEqual([])
  })

  it('НЕ трогает только что отправленную (лаг read-replica)', () => {
    const locals = [{ id: 'a', performed_at: '2026-01-01' }]
    // сервер (реплика) ещё не показывает 'a', но мы её только что запушили
    expect(selectStaleWorkoutIds(locals, [], ['a'])).toEqual([])
  })

  it('принимает и Set, и массив для serverIds/justPushed', () => {
    const locals = [{ id: 'a' }, { id: 'b' }]
    expect(selectStaleWorkoutIds(locals, new Set(['a']), new Set()).sort()).toEqual(['b'])
  })

  it('пустые/undefined входы → пустой результат', () => {
    expect(selectStaleWorkoutIds(undefined, undefined, undefined)).toEqual([])
    expect(selectStaleWorkoutIds([], [], [])).toEqual([])
  })

  // --- Воспроизведение бага и подтверждение фикса -------------------------
  // История > лимита окна. Удалена СТАРАЯ тренировка (за пределами новейшего
  // окна контента). Старая оконная логика её удаление ПРОПУСКАЛА (зазор), новая
  // сверка по полному набору id — ловит.
  it('ловит удаление записи СТАРШЕ окна, которое старая логика пропускала', () => {
    // 3 локальные записи; окно контента вернуло только 2 новейшие (лимит=2).
    const locals = [
      { id: 'new1', performed_at: '2026-03-01' },
      { id: 'new2', performed_at: '2026-02-01' },
      { id: 'old', performed_at: '2026-01-01' }, // старая, УДАЛЕНА на сервере
    ]
    const windowIds = ['new1', 'new2'] // окно (новейшие 2) — 'old' не запрашивали
    const partial = true // окно заполнено под завязку → за ним может быть ещё
    const boundary = '2026-02-01' // самая старая подтянутая дата

    // СТАРАЯ логика: 'old' старше границы → пропущена (баг: удаление не доехало).
    expect(oldWindowedStaleIds(locals, windowIds, [], { partial, boundary }))
      .toEqual([])

    // НОВАЯ логика: полный набор серверных id (без 'old', т.к. удалена) → ловим.
    const allServerIds = ['new1', 'new2'] // 'old' удалена, поэтому её нет
    expect(selectStaleWorkoutIds(locals, allServerIds, [])).toEqual(['old'])
  })

  it('НЕ удаляет старую запись, которая ещё есть на сервере (просто вне окна контента)', () => {
    const locals = [
      { id: 'new1', performed_at: '2026-03-01' },
      { id: 'old', performed_at: '2026-01-01' },
    ]
    // полный набор id включает 'old' (она жива, лишь вне окна контента) → не трогаем
    expect(selectStaleWorkoutIds(locals, ['new1', 'old'], [])).toEqual([])
  })
})

describe('reconcileStaleWorkouts (подтверждение удаления в два захода)', () => {
  it('первое отсутствие id → кандидат, НЕ удаляем (страховка от лага реплики)', () => {
    const locals = [{ id: 'a' }]
    const r = reconcileStaleWorkouts(locals, [], [], []) // сервер не вернул 'a', кандидатов нет
    expect(r.toDelete).toEqual([])
    expect(r.nextCandidates).toEqual(['a'])
  })

  it('второе подряд отсутствие id → удаляем', () => {
    const locals = [{ id: 'a' }]
    const r = reconcileStaleWorkouts(locals, [], [], ['a']) // 'a' был кандидатом с прошлого прогона
    expect(r.toDelete).toEqual(['a'])
    expect(r.nextCandidates).toEqual([])
  })

  it('запись вернулась на сервер (лаг догнал) → снимаем с кандидатов, не удаляем', () => {
    const locals = [{ id: 'a' }]
    // 'a' была кандидатом, но теперь снова в наборе серверных id
    const r = reconcileStaleWorkouts(locals, ['a'], [], ['a'])
    expect(r.toDelete).toEqual([])
    expect(r.nextCandidates).toEqual([])
  })

  it('_dirty/_deleted/justPushed никогда не попадают в кандидаты', () => {
    const locals = [
      { id: 'a', _dirty: 1 },
      { id: 'b', _deleted: 1 },
      { id: 'c' }, // чистая, только что отправлена
    ]
    const r = reconcileStaleWorkouts(locals, [], ['c'], ['a', 'b', 'c'])
    expect(r.toDelete).toEqual([])
    expect(r.nextCandidates).toEqual([])
  })

  it('принимает Set и массив для prevCandidates', () => {
    const locals = [{ id: 'a' }]
    expect(reconcileStaleWorkouts(locals, [], [], new Set(['a'])).toDelete).toEqual(['a'])
    expect(reconcileStaleWorkouts(locals, [], [], undefined).nextCandidates).toEqual(['a'])
  })
})
