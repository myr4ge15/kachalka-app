// ============================================================================
// MuscleMap — анатомический heatmap-силуэт свежести (PLAN-muscle-detail, слайс 3c).
// Реалистичная фигура (спереди/сзади): контур тела + зоны мышц раскрашиваются по
// давности тренировки. Геометрия путей — из react-native-body-highlighter (MIT,
// (c) 2022 ELABBASSI Hicham), см. src/components/muscleBodyPaths.js.
//
// Гранулярность источника — анатомическая ЗОНА (грудь, дельты, ягодичные…), чуть
// крупнее наших подмышц; поэтому зона красится по «самой пора» из своих подмышц
// (REGION_SUBS), а клик по зоне подсвечивает ВСЕ её строки в recovery-списке
// (regionOf). Полная детализация по подмышцам живёт в списке, карта — обзорная.
//
// Зона БЕЗ данных (ни разу не логировал эту мышцу — напр. трапеция, если не делал
// шраги) красится не мёртвым серым, а осмысленной ДИАГОНАЛЬНОЙ ШТРИХОВКОЙ
// «не тренировал» (pattern mm-untracked-*): пустая зона читается намеренно, а не
// как сломанная заливка. Легенду «нет данных» держит FreshnessScreen.
//
// Пропсы: bySub ({submuscle→bucket}), selected (region|null), onSelect(region).
// ============================================================================
import { BODY_OUTLINE, NEUTRAL_PARTS, FRONT_REGIONS, BACK_REGIONS } from './muscleBodyPaths.js'

const BUCKET_COLOR = {
  fresh: '#ef4444',
  recent: '#f59e0b',
  due: '#14b8a6',
  overdue: '#3b82f6',
  never: '#64748b',
}
const BODY = '#171f2c'      // заливка контура тела
const MUSCLE = '#2b374d'    // мышца без данных
const STROKE = '#3a4a63'    // контур

export function bucketColor(bucket) {
  return BUCKET_COLOR[bucket] ?? MUSCLE
}

// Анатомическая зона → наши подмышцы. Цвет зоны = «самая пора» из них.
const REGION_SUBS = {
  chest: ['chest_upper', 'chest_middle', 'chest_lower', 'serratus'],
  abs: ['abs_rectus'],
  obliques: ['abs_obliques'],
  deltoids: ['delt_front', 'delt_side', 'delt_rear'],
  biceps: ['biceps'],
  forearm: ['forearms'],
  triceps: ['triceps'],
  trapezius: ['traps'],
  'upper-back': ['lats', 'rhomboids'],
  'lower-back': ['lower_back'],
  gluteal: ['glute_max', 'glute_med'],
  quadriceps: ['quads', 'hip_flexors'],
  adductors: ['adductors'],
  hamstring: ['hamstrings'],
  calves: ['calves'],
}
const REGION_LABEL = {
  chest: 'грудь', abs: 'пресс', obliques: 'косые', deltoids: 'дельты',
  biceps: 'бицепс', forearm: 'предплечья', triceps: 'трицепс', trapezius: 'трапеция',
  'upper-back': 'широчайшие', 'lower-back': 'поясница', gluteal: 'ягодичные',
  quadriceps: 'квадрицепс', adductors: 'приводящие', hamstring: 'бицепс бедра', calves: 'икры',
}
const BUCKET_RANK = { overdue: 4, due: 3, recent: 2, fresh: 1, never: 0 }

// Обратная карта подмышца → зона (для подсветки строки списка по клику на зоне).
const SUB_REGION = {}
for (const [region, subs] of Object.entries(REGION_SUBS)) for (const s of subs) SUB_REGION[s] = region
export function regionOf(submuscle) {
  return SUB_REGION[submuscle] ?? null
}

// Бакет зоны = максимальный по «пора» среди её подмышц, что есть в данных.
function regionBucket(region, bySub) {
  let best = null
  for (const s of REGION_SUBS[region] ?? []) {
    const b = bySub[s]
    if (b && (best === null || BUCKET_RANK[b] > BUCKET_RANK[best])) best = b
  }
  return best
}

export default function MuscleMap({ bySub = {}, selected = null, onSelect }) {
  const figure = (side, regions) => {
    const viewBox = side === 'front' ? '0 0 724 1448' : '724 0 724 1448'
    const untrackedId = `mm-untracked-${side}`
    return (
      <div className="mm-col">
        <svg viewBox={viewBox} role="img" aria-label={`Силуэт ${side === 'front' ? 'спереди' : 'сзади'} — свежесть мышц`}>
          <defs>
            {/* Штриховка «нет данных»: две муарные полосы под 45° — зона без истории
                выглядит намеренно «не отслеживается», а не как мёртвый серый. */}
            <pattern id={untrackedId} patternUnits="userSpaceOnUse" width="24" height="24" patternTransform="rotate(45)">
              <rect width="24" height="24" fill="#222c3d" />
              <rect width="12" height="24" fill="#2e3a51" />
            </pattern>
          </defs>
          <path d={BODY_OUTLINE[side]} fill={BODY} stroke={STROKE} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          {(NEUTRAL_PARTS[side] ?? []).map((d, i) => (
            <path key={`n${i}`} d={d} fill={MUSCLE} stroke={STROKE} strokeWidth="1" vectorEffect="non-scaling-stroke" aria-hidden="true" />
          ))}
          {Object.entries(regions).map(([region, paths]) => {
            const bucket = regionBucket(region, bySub)
            // Есть данные → цвет давности; нет данных → штриховка «не тренировал».
            const fill = bucket ? bucketColor(bucket) : `url(#${untrackedId})`
            const sel = selected === region
            return (
              <g
                key={region}
                className={'mm-zone' + (sel ? ' sel' : '')}
                role="button"
                tabIndex={0}
                aria-label={REGION_LABEL[region] ?? region}
                aria-pressed={sel}
                onClick={() => onSelect?.(region)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect?.(region)
                  }
                }}
              >
                {paths.map((d, i) => (
                  <path key={i} d={d} fill={fill} stroke={STROKE} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            )
          })}
        </svg>
        <div className="mm-cap">{side === 'front' ? 'спереди' : 'сзади'}</div>
      </div>
    )
  }

  return (
    <div className="mm">
      {figure('front', FRONT_REGIONS)}
      {figure('back', BACK_REGIONS)}
    </div>
  )
}
