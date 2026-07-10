// ============================================================================
// MuscleMap — схематичный heatmap-силуэт свежести групп (виш BACKLOG, слайс 3).
// Две фигуры (спереди/сзади) собраны из скруглённых панелей по группам мышц
// (MVP-вариант «схематика», без покупного ассета). Каждая панель красится по
// бакету давности группы (groupBuckets из lib/freshness.js): fresh(отдыхает)=
// красный, recent=оранжевый, due(пора)=бирюзовый, overdue(давно)=синий,
// never(ни разу)=серый, нет данных → нейтральный. Зоны кликабельны — выбор
// группы подсвечивает её строку в recovery-списке (родитель держит selected).
//
// Ограничение (как в бэклоге): справочник знает только ОСНОВНУЮ группу, поэтому
// одна зона = одна группа; предплечья/икры/шея — нейтральные (не отдельные группы).
//
// Пропсы: byGroup ({group→bucket}), selected (строка|null), onSelect(group).
// ============================================================================

const BUCKET_COLOR = {
  fresh: '#ef4444',
  recent: '#f59e0b',
  due: '#14b8a6',
  overdue: '#3b82f6',
  never: '#64748b',
}
const NEUTRAL = '#273449'

export function bucketColor(bucket) {
  return BUCKET_COLOR[bucket] ?? NEUTRAL
}

export default function MuscleMap({ byGroup = {}, selected = null, onSelect }) {
  const fill = (group) => bucketColor(byGroup[group])
  const zone = (group) => ({
    className: 'mm-zone' + (selected === group ? ' sel' : ''),
    role: 'button',
    tabIndex: 0,
    'aria-label': group,
    'aria-pressed': selected === group,
    onClick: () => onSelect?.(group),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect?.(group)
      }
    },
  })

  return (
    <div className="mm">
      <div className="mm-col">
        <svg viewBox="0 0 120 250" role="img" aria-label="Силуэт спереди — свежесть мышц">
          <ellipse cx="60" cy="20" rx="12" ry="14" fill={NEUTRAL} />
          <rect x="55" y="31" width="10" height="8" rx="3" fill={NEUTRAL} />
          <g {...zone('плечи')}>
            <ellipse cx="37" cy="47" rx="12" ry="9" fill={fill('плечи')} />
            <ellipse cx="83" cy="47" rx="12" ry="9" fill={fill('плечи')} />
          </g>
          <g {...zone('грудь')}>
            <rect x="42" y="41" width="36" height="24" rx="9" fill={fill('грудь')} />
          </g>
          <g {...zone('пресс')}>
            <rect x="46" y="67" width="28" height="30" rx="7" fill={fill('пресс')} />
          </g>
          <g {...zone('бицепс')}>
            <rect x="20" y="52" width="14" height="26" rx="7" fill={fill('бицепс')} />
            <rect x="86" y="52" width="14" height="26" rx="7" fill={fill('бицепс')} />
          </g>
          <rect x="17" y="80" width="13" height="24" rx="6" fill={NEUTRAL} />
          <rect x="90" y="80" width="13" height="24" rx="6" fill={NEUTRAL} />
          <g {...zone('ноги')}>
            <rect x="43" y="101" width="15" height="50" rx="7" fill={fill('ноги')} />
            <rect x="62" y="101" width="15" height="50" rx="7" fill={fill('ноги')} />
          </g>
          <rect x="45" y="154" width="12" height="46" rx="6" fill={NEUTRAL} />
          <rect x="63" y="154" width="12" height="46" rx="6" fill={NEUTRAL} />
        </svg>
        <div className="mm-cap">спереди</div>
      </div>

      <div className="mm-col">
        <svg viewBox="0 0 120 250" role="img" aria-label="Силуэт сзади — свежесть мышц">
          <ellipse cx="60" cy="20" rx="12" ry="14" fill={NEUTRAL} />
          <g {...zone('плечи')}>
            <ellipse cx="37" cy="47" rx="12" ry="9" fill={fill('плечи')} />
            <ellipse cx="83" cy="47" rx="12" ry="9" fill={fill('плечи')} />
          </g>
          <g {...zone('спина')}>
            <rect x="42" y="41" width="36" height="30" rx="9" fill={fill('спина')} />
            <rect x="46" y="73" width="28" height="22" rx="7" fill={fill('спина')} />
          </g>
          <g {...zone('трицепс')}>
            <rect x="20" y="52" width="14" height="26" rx="7" fill={fill('трицепс')} />
            <rect x="86" y="52" width="14" height="26" rx="7" fill={fill('трицепс')} />
          </g>
          <rect x="17" y="80" width="13" height="24" rx="6" fill={NEUTRAL} />
          <rect x="90" y="80" width="13" height="24" rx="6" fill={NEUTRAL} />
          <g {...zone('ноги')}>
            <rect x="43" y="99" width="34" height="20" rx="8" fill={fill('ноги')} />
            <rect x="43" y="122" width="15" height="46" rx="7" fill={fill('ноги')} />
            <rect x="62" y="122" width="15" height="46" rx="7" fill={fill('ноги')} />
          </g>
          <rect x="45" y="171" width="12" height="30" rx="6" fill={NEUTRAL} />
          <rect x="63" y="171" width="12" height="30" rx="6" fill={NEUTRAL} />
        </svg>
        <div className="mm-cap">сзади</div>
      </div>
    </div>
  )
}
