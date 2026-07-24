// ============================================================================
// Сид локального состояния для smoke-e2e (Playwright). ТОЛЬКО для тестов.
//
// Почему сид, а не реальный вход: боевой вход идёт через Edge Function
// auth-login (сеть + секреты + free-план Supabase засыпает), а проверить нужно
// клиентский инвариант «источник правды для UI — локальная Dexie». Поэтому e2e
// кладёт ровно то, что после первого онлайн-входа и так лежит на устройстве:
//   • ростер учёток для пикера входа   → loginDb.users;
//   • офлайн-кэш своего PIN-хэша       → loginDb.meta `pin_${id}` (см. lib/auth.js);
//   • справочник упражнений            → персональная база, таблица exercises,
// а тест гоняет приложение с navigator.onLine = false → LoginScreen уходит в
// ветку verifyPinOffline, сети не требуется вовсе.
//
// ВАЖНО: модуль НЕ импортируется приложением — Playwright грузит его в странице
// динамическим import() у vite dev-сервера. В прод-бандл он не попадает (Rollup
// собирает только достижимое из index.html). Хэш PIN считаем теми же
// lib/hash.js, что и приложение, — расхождение схемы хэша сломает тест, а не
// прод, и это как раз полезный сигнал.
// ============================================================================
import { loginDb, openUserDb } from '../db/local.js'
import { pbkdf2Hex, randomSaltHex } from '../lib/hash.js'

export const E2E_USER = { id: 'e2e-user', name: 'E2E Тестер', pin: '1234' }

// Минимальный справочник: одно «весовое» упражнение (проверяет путь вес × повторы)
// и одно «на повторах» (metric: 'reps', weight всегда 0) — чтобы пикер и карточка
// подхода в тесте работали на тех же данных, что и в бою.
export const E2E_EXERCISES = [
  {
    id: 'e2e-ex-bench',
    name: 'Жим лёжа (e2e)',
    muscle_group: 'грудь',
    submuscle: 'chest_middle',
    secondary: ['triceps', 'delt_front'],
    metric: 'weight',
    is_bench_lift: true,
    is_hidden: false,
  },
  {
    id: 'e2e-ex-pullup',
    name: 'Подтягивания (e2e)',
    muscle_group: 'спина',
    submuscle: 'lats',
    secondary: ['biceps'],
    metric: 'reps',
    is_bench_lift: false,
    is_hidden: false,
  },
]

// Разложить состояние «устройство уже входило» и вернуть учётку для теста.
// Идемпотентно: повторный вызов просто перезапишет те же записи.
export async function seedE2E({ user = E2E_USER, exercises = E2E_EXERCISES } = {}) {
  const pin_salt = randomSaltHex()
  const pin_hash = await pbkdf2Hex(user.pin, pin_salt)

  await loginDb.users.put({ id: user.id, name: user.name, avatar_url: null, sort_order: 1 })
  await loginDb.meta.put({
    key: `pin_${user.id}`,
    value: { pin_hash, pin_salt, name: user.name, role: null },
  })

  const db = await openUserDb(user.id)
  await db.exercises.bulkPut(exercises)

  return { id: user.id, name: user.name, pin: user.pin }
}
