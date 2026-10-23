import { phaseOf } from '../../lib/workoutPhases.js'

// Пометка «разминка» / «заминка» у упражнения в списках (История, Лента, профиль участника, календарь, шаблоны;
// 23.10.2026, fb_c2774110: друзьям видно, что человек разминается). Основная часть — без пометки.
const TAG = { warmup: 'разминка', cooldown: 'заминка' }
export default function PhaseTag({ entry }) {
  const p = phaseOf(entry)
  return TAG[p] ? <span className="ex-phase-tag">{TAG[p]}</span> : null
}
