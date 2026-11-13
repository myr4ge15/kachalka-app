import { expect, it } from 'vitest'
import { APP_VERSION } from './appVersion.js'

// Отдельный проект Vitest подставляет undefined вместо версии сборки.
it('запуск без версии сборки использует dev', () => {
  expect(APP_VERSION).toBe('dev')
})
