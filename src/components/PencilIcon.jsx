// Карандаш «изменить» (v6.3.2) — линейная иконка в стиле остальных (stroke 2,
// скругленные концы), вместо символа ✎, который в каждом шрифте рисовался по-своему.
export default function PencilIcon({ size = 16, className = 'pencil-ico' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" />
    </svg>
  )
}
