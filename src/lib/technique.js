// Подсказки по технике: какое упражнение каталога имеет карточку (v8.0.0).
// Чистая логика над индексом src/content/techniqueIndex.js; тексты грузит
// components/TechniqueSheet.jsx лениво.

import { TECHNIQUE_INDEX } from '../content/techniqueIndex.js'

const SLUG_BY_NAME = new Map()
for (const { slug, names } of TECHNIQUE_INDEX) {
  for (const name of names) SLUG_BY_NAME.set(name, slug)
}

// Slug подсказки для упражнения каталога или null. Только общие (не свои) и не
// скрытые упражнения; название сравнивается целиком, без нечеткого поиска.
export function techniqueSlugFor(exercise) {
  if (!exercise || exercise.is_custom || exercise.is_hidden) return null
  return SLUG_BY_NAME.get(String(exercise.name ?? '').trim()) ?? null
}

// Адрес кадра из public/technique относительно base сборки.
export function techniqueFrameUrl(file, base = '/') {
  return `${base.endsWith('/') ? base : base + '/'}technique/${file}`
}
