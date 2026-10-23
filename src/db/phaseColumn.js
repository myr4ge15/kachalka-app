// Колонка phase (разминка/заминка, 23.10.2026) в выборках тренировок и шаблонов. Пока SQL с колонкой не накатан
// (бета собирается с каждого пуша), запрос с ней падает 42703 — тогда один раз переходим на выборку без нее до
// перезапуска приложения. Чтение старого сервера так не ломается; поле просто не приходит.
import { withTimeout } from '../lib/withTimeout.js'

let phaseColumn = true
export const isPhaseColumnError = (error) => error?.code === '42703' && /phase/.test(error?.message ?? '')

// build(select) → запрос PostgREST. select — строка с 'phase, '.
export async function withPhase(select, build, { timeout = withTimeout } = {}) {
  if (phaseColumn) {
    const res = await timeout(build(select))
    if (!isPhaseColumnError(res?.error)) return res
    phaseColumn = false
  }
  return timeout(build(select.replace('phase, ', '')))
}

export function resetPhaseColumn() { phaseColumn = true } // для тестов
