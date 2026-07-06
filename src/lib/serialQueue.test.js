import { describe, it, expect } from 'vitest'
import { createSerialQueue } from './serialQueue.js'

// Хелпер: промис, который резолвится через N макрозадач (микрозадержка без таймеров).
function tick(n = 1) {
  let p = Promise.resolve()
  for (let i = 0; i < n; i++) p = p.then(() => {})
  return p
}

describe('createSerialQueue', () => {
  it('операции не пересекаются: следующая стартует только после завершения предыдущей', async () => {
    const run = createSerialQueue()
    const log = []
    let active = 0

    // Каждая операция помечает вход/выход и делает несколько await внутри
    // (имитация долгой миграции с многими точками остановки).
    const op = (name, ticks) => async () => {
      active++
      expect(active).toBe(1) // критично: в любой момент активна ровно одна
      log.push(name + ':start')
      await tick(ticks)
      log.push(name + ':end')
      active--
    }

    // Быстрый выход-вход другой учёткой во время «миграции» A:
    // open(A) долгий, следом close и open(B) поставлены почти сразу.
    const pA = run(op('openA', 5)) // долгая миграция A
    const pClose = run(op('close', 1))
    const pB = run(op('openB', 2))

    await Promise.all([pA, pClose, pB])

    expect(log).toEqual([
      'openA:start', 'openA:end',
      'close:start', 'close:end',
      'openB:start', 'openB:end',
    ])
  })

  it('строгий FIFO-порядок независимо от длительности операций', async () => {
    const run = createSerialQueue()
    const order = []
    const results = await Promise.all([
      run(async () => { await tick(4); order.push('first'); return 1 }),
      run(async () => { await tick(1); order.push('second'); return 2 }),
      run(async () => { order.push('third'); return 3 }),
    ])
    expect(order).toEqual(['first', 'second', 'third'])
    expect(results).toEqual([1, 2, 3])
  })

  it('ошибка операции отдаётся вызвавшему, но не рвёт очередь', async () => {
    const run = createSerialQueue()
    const seen = []

    const pFail = run(async () => { await tick(2); throw new Error('boom') })
    const pOk = run(async () => { seen.push('after-fail'); return 'ok' })

    await expect(pFail).rejects.toThrow('boom')
    await expect(pOk).resolves.toBe('ok')
    expect(seen).toEqual(['after-fail']) // последующая операция всё равно выполнилась
  })

  it('операция, поставленная после того как очередь опустела, выполняется сразу', async () => {
    const run = createSerialQueue()
    await run(async () => 'a')
    await expect(run(async () => 'b')).resolves.toBe('b')
  })
})
