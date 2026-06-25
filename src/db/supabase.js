import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
// Publishable key (sb_publishable_...): публичный клиентский ключ, безопасен в коде.
const key = import.meta.env.VITE_SUPABASE_KEY

if (!url || !key) {
  // Явная ошибка лучше тихих 401-х при отсутствии .env
  console.error(
    'Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_KEY. ' +
    'Скопируй .env.example в .env и подставь значения из Supabase.'
  )
}

// Сессию даёт Supabase Auth (логин-мост, см. src/lib/auth.js): храним и
// автоматически обновляем токен. persistSession кладёт сессию в localStorage —
// вход переживает перезапуск приложения (окно ~7 дней задаётся в Auth→Sessions).
// detectSessionInUrl выключаем: это PWA, не OAuth-редирект.
export const supabase = createClient(url ?? '', key ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
export const isConfigured = Boolean(url && key)

// «Прогрев» базы: дешёвый запрос при старте приложения, чтобы разбудить
// бесплатный проект Supabase из паузы заранее — до того как пользователь
// нажмёт «Сохранить». Ошибки молча глотаем: это не критичный путь.
// Бьём по login_users (доступен анониму и после ужесточения RLS) — иначе
// прогрев по exercises после ужесточения словил бы 401.
export function warmup() {
  if (!isConfigured) return
  supabase
    .from('login_users')
    .select('id', { head: true, count: 'exact' })
    .then(() => {}, () => {})
}
