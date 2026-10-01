import { useMemo } from 'react'
import { spinPhaseStyle } from '../lib/spinPhase.js'

// Фаза снимается ОДИН раз — в момент, когда крутилка включилась (active: false →
// true). Пересчет на каждом рендере сдвигал бы задержку уже идущей анимации, и
// стрелка дергалась бы. Пока выключена — стиль не нужен.
export function useSpinPhase(active) {
  return useMemo(() => (active ? spinPhaseStyle() : undefined), [active])
}
