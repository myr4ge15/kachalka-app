export function mentionCandidates(comments, author) {
  const byId = new Map()
  for (const person of [author, ...comments]) {
    const name = person?.name?.trim()
    if (person?.known && person.user_id && name && !/[@\r\n]/u.test(name)) {
      byId.set(person.user_id, { id: person.user_id, name })
    }
  }
  const people = [...byId.values()]
  const counts = new Map()
  for (const { name } of people) {
    const key = name.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return people.filter(({ name }) => counts.get(name.toLowerCase()) === 1)
}

export function mentionAt(text, caret) {
  const match = /(?:^|[^\p{L}\p{N}_@])@([^@\r\n]*)$/u.exec(text.slice(0, caret))
  if (!match) return null
  return { start: caret - match[1].length - 1, end: caret, query: match[1].toLowerCase() }
}

export function mentionParts(text, people) {
  if (!people.length || !text.includes('@')) return [text]
  const names = new Map(people.map((person) => [person.name.toLowerCase(), person]))
  const pattern = [...names.keys()].sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const matches = text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_@])@(${pattern})(?![\\p{L}\\p{N}_@])`, 'giu'))
  const parts = []
  let end = 0
  for (const match of matches) {
    parts.push(text.slice(end, match.index), { ...names.get(match[1].toLowerCase()), text: match[0] })
    end = match.index + match[0].length
  }
  return [...parts, text.slice(end)]
}
