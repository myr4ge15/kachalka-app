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
      {/* Lucide Dumbbell — ISC, см. public/licenses/lucide.txt. */}
      <path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" />
      <path d="m2.5 21.5 1.4-1.4" />
      <path d="m20.1 3.9 1.4-1.4" />
      <path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" />
      <path d="m9.6 14.4 4.8-4.8" />
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
