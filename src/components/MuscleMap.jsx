// ============================================================================
// MuscleMap — heatmap-силуэт свежести по ПОДМЫШЦАМ (PLAN-muscle-detail, слайс 3b).
// Две схематичные фигуры (спереди/сзади) из скруглённых панелей, но теперь зона =
// отдельная ПОДМЫШЦА (submuscle), а не крупная группа: грудь верх/низ, дельты
// перед/сред/зад, спина широчайшие/ромбовидные/разгибатели, трапеция, бицепс/
// предплечья/трицепс, пресс/косые, квадрицепс/бицепс бедра/приводящие/икры,
// большая/средняя ягодичная. Каждая панель красится по бакету давности
// (submuscleBuckets из lib/freshness.js): fresh(отдыхает)=красный, recent=
// оранжевый, due(пора)=бирюзовый, overdue(давно)=синий, never(ни разу)=серый,
// нет данных → нейтральный. Зоны кликабельны — выбор подмышцы подсвечивает её
// строку в recovery-списке (родитель держит selected).
//
// Пропсы: bySub ({submuscle→bucket}), selected (слаг|null), onSelect(submuscle).
// ============================================================================
import { labelOf } from '../lib/muscles.js'

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

export default function MuscleMap({ bySub = {}, selected = null, onSelect }) {
  const fill = (sub) => bucketColor(bySub[sub])
  const zone = (sub) => ({
    className: 'mm-zone' + (selected === sub ? ' sel' : ''),
    role: 'button',
    tabIndex: 0,
    'aria-label': labelOf(sub),
    'aria-pressed': selected === sub,
    onClick: () => onSelect?.(sub),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect?.(sub)
      }
    },
  })

  return (
    <div className="mm">
      <div className="mm-col">
        <svg viewBox="0 0 120 250" role="img" aria-label="Силуэт спереди — свежесть мышц">
          {/* голова / шея (нейтрально) */}
          <ellipse cx="60" cy="18" rx="11" ry="13" fill={NEUTRAL} />
          <rect x="55" y="29" width="10" height="7" rx="3" fill={NEUTRAL} />

          {/* дельты: средняя (латерально) под передней */}
          <g {...zone('delt_side')}>
            <ellipse cx="24" cy="49" rx="7" ry="8" fill={fill('delt_side')} />
            <ellipse cx="96" cy="49" rx="7" ry="8" fill={fill('delt_side')} />
          </g>
          <g {...zone('delt_front')}>
            <ellipse cx="35" cy="46" rx="11" ry="8" fill={fill('delt_front')} />
            <ellipse cx="85" cy="46" rx="11" ry="8" fill={fill('delt_front')} />
          </g>

          {/* грудь: верх / низ */}
          <g {...zone('chest_upper')}>
            <rect x="43" y="40" width="34" height="11" rx="6" fill={fill('chest_upper')} />
          </g>
          <g {...zone('chest_lower')}>
            <rect x="44" y="52" width="32" height="14" rx="6" fill={fill('chest_lower')} />
          </g>

          {/* пресс: прямая (центр) + косые (по бокам) */}
          <g {...zone('abs_obliques')}>
            <rect x="42" y="69" width="6" height="28" rx="3" fill={fill('abs_obliques')} />
            <rect x="72" y="69" width="6" height="28" rx="3" fill={fill('abs_obliques')} />
          </g>
          <g {...zone('abs_rectus')}>
            <rect x="50" y="68" width="20" height="30" rx="5" fill={fill('abs_rectus')} />
          </g>

          {/* руки: бицепс + предплечья */}
          <g {...zone('biceps')}>
            <rect x="21" y="53" width="13" height="23" rx="6" fill={fill('biceps')} />
            <rect x="86" y="53" width="13" height="23" rx="6" fill={fill('biceps')} />
          </g>
          <g {...zone('forearms')}>
            <rect x="18" y="78" width="13" height="24" rx="6" fill={fill('forearms')} />
            <rect x="89" y="78" width="13" height="24" rx="6" fill={fill('forearms')} />
          </g>
          <circle cx="23" cy="107" r="4" fill={NEUTRAL} />
          <circle cx="97" cy="107" r="4" fill={NEUTRAL} />

          {/* ноги: квадрицепс + приводящие (внутр.) */}
          <g {...zone('quads')}>
            <rect x="43" y="100" width="15" height="50" rx="7" fill={fill('quads')} />
            <rect x="62" y="100" width="15" height="50" rx="7" fill={fill('quads')} />
          </g>
          <g {...zone('adductors')}>
            <rect x="57" y="104" width="6" height="38" rx="3" fill={fill('adductors')} />
          </g>
          {/* голени спереди — нейтрально (икры на виде сзади) */}
          <rect x="45" y="152" width="12" height="46" rx="6" fill={NEUTRAL} />
          <rect x="63" y="152" width="12" height="46" rx="6" fill={NEUTRAL} />
        </svg>
        <div className="mm-cap">спереди</div>
      </div>

      <div className="mm-col">
        <svg viewBox="0 0 120 250" role="img" aria-label="Силуэт сзади — свежесть мышц">
          <ellipse cx="60" cy="18" rx="11" ry="13" fill={NEUTRAL} />

          {/* задняя дельта */}
          <g {...zone('delt_rear')}>
            <ellipse cx="35" cy="48" rx="11" ry="8" fill={fill('delt_rear')} />
            <ellipse cx="85" cy="48" rx="11" ry="8" fill={fill('delt_rear')} />
          </g>

          {/* трапеция (верх спины/шея) */}
          <g {...zone('traps')}>
            <rect x="48" y="34" width="24" height="15" rx="6" fill={fill('traps')} />
          </g>
          {/* ромбовидные (центр под трапецией) */}
          <g {...zone('rhomboids')}>
            <rect x="50" y="47" width="20" height="12" rx="4" fill={fill('rhomboids')} />
          </g>
          {/* широчайшие (бока спины) */}
          <g {...zone('lats')}>
            <rect x="43" y="52" width="13" height="21" rx="6" fill={fill('lats')} />
            <rect x="64" y="52" width="13" height="21" rx="6" fill={fill('lats')} />
          </g>
          {/* разгибатели (поясница) */}
          <g {...zone('lower_back')}>
            <rect x="48" y="73" width="24" height="13" rx="5" fill={fill('lower_back')} />
          </g>

          {/* трицепс */}
          <g {...zone('triceps')}>
            <rect x="21" y="53" width="13" height="23" rx="6" fill={fill('triceps')} />
            <rect x="86" y="53" width="13" height="23" rx="6" fill={fill('triceps')} />
          </g>
          <rect x="18" y="78" width="13" height="24" rx="6" fill={NEUTRAL} />
          <rect x="89" y="78" width="13" height="24" rx="6" fill={NEUTRAL} />

          {/* ягодицы: большая (центр) + средняя (внешние верхние) */}
          <g {...zone('glute_med')}>
            <rect x="41" y="88" width="8" height="13" rx="4" fill={fill('glute_med')} />
            <rect x="71" y="88" width="8" height="13" rx="4" fill={fill('glute_med')} />
          </g>
          <g {...zone('glute_max')}>
            <rect x="45" y="90" width="30" height="18" rx="8" fill={fill('glute_max')} />
          </g>

          {/* бицепс бедра (задняя поверхность) */}
          <g {...zone('hamstrings')}>
            <rect x="44" y="110" width="15" height="44" rx="7" fill={fill('hamstrings')} />
            <rect x="61" y="110" width="15" height="44" rx="7" fill={fill('hamstrings')} />
          </g>
          {/* икры */}
          <g {...zone('calves')}>
            <rect x="45" y="156" width="13" height="32" rx="6" fill={fill('calves')} />
            <rect x="62" y="156" width="13" height="32" rx="6" fill={fill('calves')} />
          </g>
        </svg>
        <div className="mm-cap">сзади</div>
      </div>
    </div>
  )
}
