// Мини-разбор Markdown для встроенной инструкции (v6.16.0, components/QuickStartSheet.jsx).
// Только то, что есть в docs/quick-start.md: заголовки #–###, абзацы, списки «- »
// и «1. », цитата «> », черта «---» и **жирный**. Отдает блоки-данные, а не HTML:
// рисует их React, так что разметка из текста в DOM не попадет.

const HEAD = /^(#{1,3})\s+(.*)$/
const UL = /^[-*]\s+(.*)$/
const OL = /^\d+\.\s+(.*)$/

export function parseMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let para = null
  let list = null
  const flush = () => { para = null; list = null }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    let m
    if ((m = HEAD.exec(line))) { flush(); blocks.push({ type: 'h', level: m[1].length, text: m[2] }); continue }
    if (/^-{3,}$/.test(line)) { flush(); blocks.push({ type: 'hr' }); continue }
    if (line.startsWith('>')) { flush(); blocks.push({ type: 'quote', text: line.replace(/^>\s?/, '') }); continue }
    const ul = UL.exec(line)
    const ol = ul ? null : OL.exec(line)
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol'
      if (!list || list.type !== type) { para = null; list = { type, items: [] }; blocks.push(list) }
      list.items.push((ul ?? ol)[1])
      continue
    }
    if (para) { para.text += ' ' + line; continue }
    list = null
    para = { type: 'p', text: line }
    blocks.push(para)
  }
  return blocks
}

// «a **b** c» → [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }].
// Непарная «**» остается текстом.
export function inlineParts(text) {
  const parts = String(text ?? '').split('**')
  if (parts.length % 2 === 0) return [{ text: String(text ?? '') }]
  return parts.map((t, i) => ({ text: t, bold: i % 2 === 1 })).filter((p) => p.text)
}
