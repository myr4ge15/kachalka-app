import { useMemo } from 'react'
import SheetDialog from './SheetDialog.jsx'
import { inlineParts, parseMarkdown } from '../lib/miniMarkdown.js'
import quickStart from '../../docs/quick-start.md?raw'

// «Подробная инструкция» внутри приложения (v6.16.0): docs/quick-start.md вшит в
// сборку (отдельный чанк — грузится, только когда открыли) и открывается листом
// поверх приветствия — без GitHub и без интернета. Заголовок # из файла не
// показываем: он и есть заголовок листа.
// Пропсы: onClose() — закрыть.

function Inline({ text }) {
  return inlineParts(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))
}

export default function QuickStartSheet({ onClose }) {
  const blocks = useMemo(() => parseMarkdown(quickStart).filter((b) => !(b.type === 'h' && b.level === 1)), [])
  return (
    <SheetDialog title="Быстрый старт" actionLabel="закрыть" onDismiss={() => onClose?.()}>
      <div className="sheet-scroll qs-doc">
        {blocks.map((b, i) => {
          if (b.type === 'h') return b.level === 2 ? <h3 key={i}><Inline text={b.text} /></h3> : <h4 key={i}><Inline text={b.text} /></h4>
          if (b.type === 'hr') return <hr key={i} />
          if (b.type === 'quote') return <blockquote key={i}><Inline text={b.text} /></blockquote>
          if (b.type === 'ul' || b.type === 'ol') {
            const List = b.type
            return <List key={i}>{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</List>
          }
          return <p key={i}><Inline text={b.text} /></p>
        })}
      </div>
    </SheetDialog>
  )
}
