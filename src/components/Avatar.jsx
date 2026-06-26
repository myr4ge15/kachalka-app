// Аватар пользователя (ЛК фаза 2c). Есть avatar_url → картинка, иначе — прежний
// инициал имени. Класс контейнера передаётся снаружи (`avatar`, `avatar-lg`,
// `avatar-sm`), стили для img-варианта — `.has-img` в index.css.
export default function Avatar({ name, url, className = 'avatar' }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?'
  if (url) {
    return (
      <img
        className={`${className} has-img`}
        src={url}
        alt=""
        aria-hidden="true"
        loading="lazy"
      />
    )
  }
  return <div className={className} aria-hidden="true">{initial}</div>
}
