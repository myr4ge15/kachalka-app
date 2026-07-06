// Аватар пользователя (ЛК фаза 2c). Есть avatar_url → картинка, иначе — прежний
// инициал имени. Класс контейнера передаётся снаружи (`avatar`, `avatar-lg`,
// `avatar-sm`), стили для img-варианта — `.has-img` в index.css.
import { useState, useEffect } from 'react'

export default function Avatar({ name, url, className = 'avatar' }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?'
  // Если картинка не загрузилась (офлайн и нет в кэше SW, битый URL) — вместо
  // «сломанной картинки» молча показываем инициал. Сбрасываем флаг при смене url.
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [url])

  if (url && !failed) {
    return (
      <img
        className={`${className} has-img`}
        src={url}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    )
  }
  return <div className={className} aria-hidden="true">{initial}</div>
}
