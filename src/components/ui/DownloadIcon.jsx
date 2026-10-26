// «Скачать» — штриховая иконка вместо символа «⬇» (26.10.2026, fb_3830b581): на iPhone «⬇»
// рисовался синим эмодзи-квадратом и выбивался из оформления. Цвет — от текста, размер — size.
export default function DownloadIcon({ size = 16, strokeWidth = 2.2, className = '' }) {
  return <svg className={`ui-download ${className}`.trim()} viewBox="0 0 24 24" width={size} height={size}
    fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
  </svg>
}
