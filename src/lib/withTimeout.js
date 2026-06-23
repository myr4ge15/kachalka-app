// Гонка запроса с таймаутом: если сеть «висит», промис не зависнет навсегда,
// а отклонится с понятной ошибкой — кнопки сохранения/загрузки перестанут крутиться.
export const DB_TIMEOUT_MS = 15000

export function withTimeout(promise, ms = DB_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Превышено время ожидания сети. Проверь связь и попробуй ещё раз.')),
        ms
      )
    ),
  ])
}
