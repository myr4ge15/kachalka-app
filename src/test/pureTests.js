// Какие тесты можно гонять без изоляции (vite.config.js, проект vitest «lib-pure», 26.10.2026).
//
// По умолчанию Vitest поднимает на каждый файл свой процесс (~0,6 с на старт): у 106 чистых тестов
// src/lib сама работа — миллисекунды, старт был дороже. Без изоляции файлы идут в одном процессе
// подряд, поэтому сюда попадает только то, что НЕ оставляет следов для соседей: без моков модулей,
// шпионов, фейковых часов, глобалов браузера, IndexedDB и окружения. Решает содержимое файла, а не
// список: новый тест с vi.mock сам уйдет в изолированный проект.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LEAVES_TRACES = /vitest-environment|vi\.(mock|doMock|unmock|stubGlobal|stubEnv|useFakeTimers|spyOn|resetModules|importActual)|fake-indexeddb|globalThis|window|navigator|localStorage|sessionStorage|document|process\.env/

export const isPureTest = (source) => !LEAVES_TRACES.test(source)

// Пути относительно корня проекта, через «/» (так их сравнивает include Vitest).
export function pureLibTests(root) {
  const dir = join(root, 'src', 'lib')
  return readdirSync(dir, { recursive: true })
    .map((f) => String(f).split('\\').join('/'))
    .filter((f) => f.endsWith('.test.js') && isPureTest(readFileSync(join(dir, f), 'utf8')))
    .map((f) => `src/lib/${f}`)
    .sort()
}
