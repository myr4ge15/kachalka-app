// Вынесено из App.jsx (v6.14.1).
// Иконки нижней панели — инлайн-SVG (без зависимостей), красятся через currentColor,
// плавную смену цвета и легкое увеличение активной задает CSS (.tab / .tab-ico).
export default function TabIcon({ name }) {
  const p = {
    className: 'tab-ico', viewBox: '0 0 24 24', width: 24, height: 24,
    fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }
  if (name === 'home') return (
    <svg {...p}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </svg>
  )
  if (name === 'history') return (
    <svg {...p}>
      {/* Гантель как в логотипе (v6.15.0): гриф и по два блина, тем же штрихом, что
          соседние иконки. Прежняя Lucide Dumbbell (диагональ, двойной контур) выбивалась. */}
      <path d="M8 12h8" />
      <rect x="5" y="6" width="3" height="12" rx="1" />
      <rect x="16" y="6" width="3" height="12" rx="1" />
      <path d="M2.5 9.5v5M21.5 9.5v5" />
    </svg>
  )
  if (name === 'feed') return (
    <svg {...p}>
      <path d="M16 6h3a1 1 0 0 1 1 1v11a2 2 0 0 1-4 0v-13a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v12a3 3 0 0 0 3 3h11" />
      <path d="M8 8h4M8 12h4M8 16h4" />
    </svg>
  )
  return (
    <svg {...p}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  )
}
