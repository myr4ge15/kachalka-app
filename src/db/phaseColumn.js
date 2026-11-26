// Колонка phase (разминка/заминка, 23.10.2026) в выборках тренировок и шаблонов. Пока SQL с колонкой не накатан
// (бета собирается с каждого пуша), запрос с ней падает 42703 — тогда один раз переходим на выборку без нее до
// перезапуска приложения. Чтение старого сервера так не ломается; поле просто не приходит.
import { withTimeout } from '../lib/withTimeout.js'

let phaseColumn = true
export const isPhaseColumnError = (error) => error?.code === '42703' && /phase/.test(error?.message ?? '')

// build(select) → запрос PostgREST. select — строка с 'phase, '.
export async function withPhase(select, build, { timeout = withTimeout } = {}) {
  // До наката серверного хранения метрик офлайн-история и лента по-прежнему читаются.
  async function read(fields) {
    const res = await timeout(build(fields))
    if (fields.includes('load_input, ') && res?.error?.code === '42703' && /load_input/.test(res.error.message ?? '')) {
      return read(fields.replace('load_input, ', ''))
    }
    if (fields.includes('historical_metric, ') && res?.error?.code === '42703'
      && /historical_metric/.test(res.error.message ?? '')) {
      return read(fields.replace('historical_metric, ', ''))
    }
    return res
  }
  if (phaseColumn) {
    const res = await read(select)
    if (!isPhaseColumnError(res?.error)) return res
    phaseColumn = false
  }
  return read(select.replace('phase, ', ''))
}

export function resetPhaseColumn() { phaseColumn = true } // для тестов
