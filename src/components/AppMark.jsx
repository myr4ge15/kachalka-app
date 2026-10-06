// Знак приложения на экранах входа и регистрации (v6.16.0 — общий компонент:
// до этого регистрация по приглашению рисовала старую тонкую штангу). Та же
// штанга, что на сплэше (index.html #splash), без анимации.
export default function AppMark() {
  return (
    <div className="login-mark" aria-hidden="true">
      <svg viewBox="37 62 126 76" width="84" height="51" focusable="false">
        <rect className="login-mark-bar" x="37.5" y="93.75" width="125" height="12.5" rx="6.25" />
        <rect x="59.4" y="68.75" width="13.3" height="62.5" rx="4.7" />
        <rect x="127.3" y="68.75" width="13.3" height="62.5" rx="4.7" />
        <rect x="43.75" y="76.6" width="13.3" height="46.9" rx="4.7" />
        <rect x="143" y="76.6" width="13.3" height="46.9" rx="4.7" />
      </svg>
    </div>
  )
}
