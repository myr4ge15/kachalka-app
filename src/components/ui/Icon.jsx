// Линейные иконки строк меню и кнопок (26.10.2026, аудит оформления, fb_3830b581).
// Один штрих с таббаром (TabIcon): 24×24, stroke 2, скругленные концы, цвет — currentColor.
// Раньше в строках Профиля и Настроек стояли эмодзи (👥 ⭕ ⚙️ 💾…): на iPhone они рисуются
// цветными картинками и выбивались из «Спорт-блоков». Новую иконку — сюда, а не инлайном в экран.
const PATHS = {
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>,
  circle: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 18.5a6 6 0 0 1 11 0" /></>,
  invite: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" /></>,
  message: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4.2A2.5 2.5 0 0 1 4 13.5z" />,
  shield: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  sparkles: <><path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  timer: <><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4l2.5 2M9.5 2.5h5" /></>,
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0" />,
  idcard: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16a3.4 3.4 0 0 1 6.4 0M14.5 10h3.5M14.5 13.5h3.5" /></>,
  key: <><circle cx="7.5" cy="15.5" r="4" /><path d="M10.5 12.5L20 3M16 7l2.5 2.5M13.5 9.5l2 2" /></>,
  lifebuoy: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6" /></>,
  book: <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5zM4 21.5A2.5 2.5 0 0 1 6.5 19H20" />,
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />,
  upload: <path d="M12 15.5V4.5M7 9l5-5 5 5M5 19.5h14" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />,
  userx: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20a6.5 6.5 0 0 1 13 0M17 8.5l4 4M21 8.5l-4 4" /></>,
  logout: <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M14 16l4-4-4-4M18 12H9" />,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H4.5v1a3.5 3.5 0 0 0 3.7 3.5M16 6h3.5v1a3.5 3.5 0 0 1-3.7 3.5M12 13v4M8.5 20.5h7M10 17h4" /></>,
  podium: <path d="M3 20.5h18M5 20.5v-6h4v6M10 20.5V9h4v11.5M15 20.5v-8h4v8" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2.5" /><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-7A2.5 2.5 0 0 0 4 5.5v9A2.5 2.5 0 0 0 6.5 17H8" /></>,
  template: <><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></>,
  repeat: <><path d="M17 2.5l3 3-3 3" /><path d="M4 11.5v-2a4 4 0 0 1 4-4h12M7 21.5l-3-3 3-3" /><path d="M20 12.5v2a4 4 0 0 1-4 4H4" /></>,
  alarm: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 1.5M4 4.5l3-2.5M20 4.5L17 2" /></>,
  heart: <path d="M12 20.5s-8-4.6-8-10.7A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8 2.8c0 6.1-8 10.7-8 10.7z" />,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  block: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  eye: <><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" /></>,
  eyeoff: <><path d="M10.6 5.1A9.6 9.6 0 0 1 12 5c6 0 9.5 7 9.5 7a16 16 0 0 1-2.2 3.1M6.6 6.6A15.6 15.6 0 0 0 2.5 12S6 19 12 19a9.4 9.4 0 0 0 5.4-1.6" /><path d="M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  grip: <path d="M5 8h14M5 12h14M5 16h14" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  refresh: <><path d="M20 11.5A8 8 0 1 0 17.7 17" /><path d="M20.5 5v6.5H14" /></>,
  clip: <path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />,
  image: <><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M21 15.5l-5-5-9 9" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3A4.5 4.5 0 0 0 13 4.6l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>,
  camera: <><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.5-2h4.4l1.5 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" /><circle cx="12" cy="12.5" r="3.5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>,
  scale: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M8 10a5 5 0 0 1 8 0M12 10.5l1.6-2.2" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: <><path d="M12 3.5L2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  offline: <><path d="M2.5 8.5a14 14 0 0 1 4.6-2.9M10.5 4.6A14 14 0 0 1 21.5 8.5M5.5 12a9.5 9.5 0 0 1 3.4-2M15 10.2a9.5 9.5 0 0 1 3.5 1.8M9 15.5a4.5 4.5 0 0 1 6 0M12 19v.01" /><path d="M3 3l18 18" /></>,
  pencil: <path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5zM14 7l3 3" />,
}

export const ICON_NAMES = Object.keys(PATHS)

export default function Icon({ name, size = 20, strokeWidth = 2, className = '' }) {
  const body = PATHS[name]
  if (!body) return null
  return (
    <svg className={`ui-icon ${className}`.trim()} viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {body}
    </svg>
  )
}
