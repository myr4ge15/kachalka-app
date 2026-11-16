import { daySubTags, tagSlug } from '../../lib/dayTags.js'
import { labelOf, majorOf } from '../../lib/muscles.js'

export default function MuscleTags({ entries }) {
  const tags = daySubTags(entries)
  if (!tags.length) return null

  return (
    <div className="day-tags" aria-label="Мышцы. Цвет соответствует крупной группе" title="Цвет чипа соответствует крупной группе мышц" role="group">
      {tags.map((tag) => (
        <span key={tag} className={`day-tag tag-${tagSlug(majorOf(tag))}`}>{labelOf(tag)}</span>
      ))}
    </div>
  )
}
