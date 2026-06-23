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

export const supabase = createClient(url ?? '', key ?? '')
export const isConfigured = Boolean(url && key)

// «Прогрев» базы: дешёвый запрос при старте приложения, чтобы разбудить
// бесплатный проект Supabase из паузы заранее — до того как пользователь
// нажмёт «Сохранить». Ошибки молча глотаем: это не критичный путь.
export function warmup() {
  if (!isConfigured) return
  supabase
    .from('exercises')
    .select('id', { head: true, count: 'exact' })
    .then(() => {}, () => {})
}
