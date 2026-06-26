// ============================================================================
// Аватар (ЛК фаза 2c) — клиентское сжатие + загрузка в Supabase Storage.
//
// Обязательное сжатие на клиенте: ≤256px по большей стороне, JPEG ~0.8
// (~30–50 КБ). Public bucket `avatars`, путь `${userId}/avatar.jpg` (RLS пускает
// запись только владельцу по первому сегменту пути == app_uid()). После аплоада
// публичный URL пишем в users.avatar_url через SECURITY DEFINER set_my_avatar_url.
//
// fitDimensions вынесена отдельно (чистая, без DOM) — её и юнит-тестим.
// ============================================================================
import { supabase } from '../db/supabase.js'

// Вписать (w,h) в квадрат max, сохраняя пропорции; апскейл не делаем (scale≤1).
export function fitDimensions(w, h, max = 256) {
  const longest = Math.max(w, h)
  const scale = longest > 0 ? Math.min(1, max / longest) : 1
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  }
}

// Загрузить File в HTMLImageElement (через object URL, который потом отзываем).
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve(img); URL.revokeObjectURL(url) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')) }
    img.src = url
  })
}

// Сжать картинку до JPEG ≤max px по большей стороне. Возвращает Blob.
export async function compressToJpeg(file, max = 256, quality = 0.8) {
  const img = await loadImage(file)
  const { w, h } = fitDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height, max)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Сжатие не удалось'))), 'image/jpeg', quality)
  )
  return blob
}

// Сжать → залить (upsert) → записать публичный URL через RPC. Возвращает URL.
// К URL добавляем ?v=<ts> — путь фиксированный (upsert), и без этого CDN/браузер
// показывали бы старую картинку после замены.
export async function uploadMyAvatar(userId, file) {
  const blob = await compressToJpeg(file)
  const path = `${userId}/avatar.jpg`
  const up = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (up.error) throw up.error

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  const url = `${data.publicUrl}?v=${Date.now()}`
  const rpc = await supabase.rpc('set_my_avatar_url', { p_url: url })
  if (rpc.error) throw rpc.error
  return url
}
