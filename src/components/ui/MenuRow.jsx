import Chevron from './Chevron.jsx'
import Icon from './Icon.jsx'

// Строка меню — одна на все списки пунктов (26.10.2026, аудит оформления, fb_3830b581).
// До нее в Профиле и Настройках жили четыре рецепта строк (.act без стрелки, .settings-toggle,
// .leader-link с «Открыть ›», голые .wk-act), иконками служили эмодзи.
// Раскладка: [иконка в плашке] заголовок + пояснение … [бейдж] [хвост]. Хвост по kind:
//   nav    — переход на другой экран: «›»;
//   expand — раскрытие на месте: «⌄/⌃» (Chevron toggle), aria-expanded;
//   switch — тумблер (role="switch", aria-checked);
//   action — действие на месте: без хвоста.
// tone="danger" — красная строка (удаления); highlight — акцентная рамка («есть новое»).
// end — свой хвост вместо стандартного (статус рядом с тумблером и т. п.).
export default function MenuRow({
  icon, title, sub, kind = 'nav', open = false, checked = false, badge = null,
  tone = '', highlight = false, end = null, className = '', onClick, children, ...rest
}) {
  const cls = ['act', 'menu-row', tone && `menu-row--${tone}`, tone === 'danger' && 'danger',
    highlight && 'act-new', kind === 'expand' && open && 'is-open', className].filter(Boolean).join(' ')
  const a11y = kind === 'expand' ? { 'aria-expanded': open }
    : kind === 'switch' ? { role: 'switch', 'aria-checked': checked } : {}
  const tail = end ?? (
    kind === 'nav' ? <Chevron className="menu-row-chev" size={18} />
      : kind === 'expand' ? <Chevron toggle open={open} className="menu-row-chev" size={18} />
        : kind === 'switch' ? (
          <span className={'toggle-pill' + (checked ? ' on' : '')} aria-hidden="true"><span className="toggle-knob" /></span>
        ) : null
  )
  return (
    <button type="button" className={cls} onClick={onClick} {...a11y} {...rest}>
      {icon && <span className="act-ico"><Icon name={icon} size={19} /></span>}
      <span className="act-txt">
        <span className="act-title">{title}</span>
        {sub != null && sub !== '' && <span className="act-sub">{sub}</span>}
        {children}
      </span>
      {badge != null && badge !== false && <span className="act-badge">{badge}</span>}
      {tail}
    </button>
  )
}
