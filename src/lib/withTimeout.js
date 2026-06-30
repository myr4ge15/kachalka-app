// Гонка запроса с таймаутом: если сеть «висит», промис не зависнет навсегда,
// а отклонится с понятной ошибкой — кнопки сохранения/загрузки перестанут крутиться.
// 30 сек: бесплатный проект Supabase может «просыпаться» из паузы 10–20 сек,
// 15 сек на холодный старт не хватало — запрос успевал закоммититься, но клиент
// уже сдавался по таймауту.
export const DB_TIMEOUT_MS = 30000

export function withTimeout(builder, ms = DB_TIMEOUT_MS) {
  // Раньше Promise.race только ОТКЛОНЯЛ обёртку по таймауту, а сам запрос
  // продолжал жить: на холодном пробуждении free-tier он часто успевал
  // закоммититься уже ПОСЛЕ того, как клиент сдался, но `attempts` всё равно
  // инкрементился → фактически успешная операция могла добить до dead-letter.
  // Теперь по таймауту реально ОТМЕНЯЕМ запрос через AbortController.
  // PostgREST-билдер (`supabase.from().*`, `supabase.rpc()`) умеет .abortSignal();
  // если передали обычный промise (напр. supabase.auth.signOut) — работаем как
  // прежде (без отмены), не падая.
  const controller = new AbortController()
  const p =
    builder && typeof builder.abortSignal === 'function'
      ? builder.abortSignal(controller.signal)
      : builder
  let timer
  return Promise.race([
    Promise.resolve(p),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { controller.abort() } catch { /* нет abortSignal — просто отклоняемся */ }
        reject(new Error('Превышено время ожидания сети. Проверь связь и попробуй ещё раз.'))
      }, ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
