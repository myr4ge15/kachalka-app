// Знак приложения — одна штанга везде (иконка на экране «Домой», сплэш
// index.html #splash, вход/регистрация, бренд боковой колонки ПК).
// v6.16.0 — общий компонент для входа и регистрации; v7.1.4 — глиф вынесен
// в AppMarkGlyph, им же рисуется лого сайдбара (до этого там была своя
// тонкая штанга другой формы). Блины — currentColor, гриф — класс app-mark-bar.
export function AppMarkGlyph({ width, height }) {
  return (
    <svg viewBox="37 62 126 76" width={width} height={height} focusable="false" aria-hidden="true">
      <rect className="app-mark-bar" x="37.5" y="93.75" width="125" height="12.5" rx="6.25" />
      <rect x="59.4" y="68.75" width="13.3" height="62.5" rx="4.7" />
      <rect x="127.3" y="68.75" width="13.3" height="62.5" rx="4.7" />
      <rect x="43.75" y="76.6" width="13.3" height="46.9" rx="4.7" />
      <rect x="143" y="76.6" width="13.3" height="46.9" rx="4.7" />
    </svg>
  )
}

export default function AppMark() {
  return (
    <div className="login-mark" aria-hidden="true">
      <AppMarkGlyph width="84" height="51" />
    </div>
  )
}
