// ============================================================================
// «Мой круг» (07.10.2026, supabase/friend-circles.sql + friend-circle-rating.sql).
// Чистая логика (код, ссылка, тексты) + онлайн-операции. Как приглашения
// (lib/memberInvites.js): вне очередей синка, только онлайн и под своей сессией.
//
// Личный код участника — 8 знаков Crockford Base32, показ «7F3Q-9XWD». Ссылка с ним:
// …/kachalka-app/#join=7F3Q9XWD (во фрагменте — на сервер страницы не уходит; App
// забирает и сразу стирает, как #invite=).
// ============================================================================
import { supabase, hasSession } from '../db/supabase.js'
import { withTimeout } from './withTimeout.js'

const ALPHABET_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/

// Регистр, дефисы и пробелы не важны; O→0, I/L→1 (как fc_code_norm в SQL). Не код — null.
export function normCode(v) {
  const s = String(v ?? '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '')
  return ALPHABET_RE.test(s) ? s : null
}

export function fmtCode(v) {
  const n = normCode(v)
  return n ? `${n.slice(0, 4)}-${n.slice(4)}` : ''
}

export function joinFromUrl(href) {
  try {
    const hash = new URL(String(href)).hash.replace(/^#/, '')
    return normCode(new URLSearchParams(hash).get('join'))
  } catch {
    return null
  }
}

export function stripJoin(href) {
  try {
    const url = new URL(String(href))
    if (!new URLSearchParams(url.hash.replace(/^#/, '')).has('join')) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function joinUrl(code, origin, base = '/') {
  const b = base.endsWith('/') ? base : base + '/'
  return `${origin}${b}#join=${normCode(code) ?? ''}`
}

// Текст для «Поделиться» / «Скопировать»: код + ссылка последней строкой.
export function joinMessage({ circle = '', code = '', url = '' } = {}) {
  const lines = [
    `Зову тебя в наш круг${circle ? ` «${circle}»` : ''} в журнале тренировок 💪`,
    'Открой ссылку — или в приложении: Профиль → «Мой круг» → «Вступить по коду».',
  ]
  if (code) lines.push(`Код: ${fmtCode(code)}`)
  if (url) lines.push(url)
  return lines.join('\n')
}

// Статус вступления → текст.
export function joinStatusText(status) {
  switch (status) {
    case 'active': return 'Ты в круге 🎉'
    case 'pending': return 'Заявка отправлена — владелец круга решит.'
    case 'already': return 'Ты уже в этом круге.'
    case 'max_circles': return 'Можно быть не больше чем в 5 кругах. Выйди из какого-нибудь.'
    case 'full': return 'В этом круге больше нет мест.'
    case 'limited': return 'Слишком много попыток — подожди час.'
    case 'busy': return 'Сегодня по кодам пришло слишком много людей — попробуй завтра.'
    case 'invalid': return 'Код не подходит: опечатка, он устарел или его отозвали. Попроси новый.'
    default: return 'Не получилось — попробуй позже.'
  }
}

// «до 14.10 · вступили 3 из 10»
export function codeMeta({ expires_at: expiresAt, uses = 0, max_uses: maxUses = 10 } = {}) {
  const d = expiresAt ? new Date(expiresAt) : null
  const until = d && !Number.isNaN(d.getTime())
    ? `до ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}` : ''
  return [until, `вступили ${uses} из ${maxUses}`].filter(Boolean).join(' · ')
}

export class CircleError extends Error {}

function humanError(error) {
  const m = String(error?.message ?? '')
  if (error?.code === '42501' || m.includes('forbidden')) return 'Нет доступа — ты не в этом круге или не его владелец.'
  if (m.includes('own circle exists')) return 'Свой круг у тебя уже есть.'
  if (m.includes('max circles')) return 'Можно быть не больше чем в 5 кругах.'
  if (m.includes('bad name')) return 'Название — от 1 до 40 символов.'
  if (m.includes('rate limited')) return 'Слишком часто — попробуй завтра.'
  if (m.includes('недоступно') || m.includes('Не заданы')) return 'Это упражнение нельзя взять в рейтинг.'
  if (error?.code === 'PGRST202') return '«Мой круг» пока недоступен. Попробуй позже.'
  return 'Не получилось. Проверь связь и попробуй еще раз.'
}

async function rpc(userId, name, args) {
  if (!navigator.onLine) throw new CircleError('Нужен интернет.')
  if (!await hasSession(userId)) throw new CircleError('Войди в свою учетную запись с интернетом.')
  let res
  try {
    res = await withTimeout(args ? supabase.rpc(name, args) : supabase.rpc(name))
  } catch {
    throw new CircleError('Нет сети — попробуй позже.')
  }
  if (res.error) throw new CircleError(humanError(res.error))
  return res.data
}

const first = (d) => (Array.isArray(d) ? d[0] : d)

export function circleApi(userId) {
  return {
    async myCircles() { return (await rpc(userId, 'fc_my_circles')) ?? [] },
    async create(name) {
      const clean = String(name ?? '').trim().replace(/\s+/g, ' ')
      if (clean.length < 1 || clean.length > 40) throw new CircleError('Название — от 1 до 40 символов.')
      return rpc(userId, 'fc_create', { p_name: clean })
    },
    rename: (circle, name) => rpc(userId, 'fc_rename', { p_circle: circle, p_name: String(name ?? '').trim() }),
    setAutoApprove: (circle, on) => rpc(userId, 'fc_set_auto_approve', { p_circle: circle, p_on: Boolean(on) }),
    async members(circle) { return (await rpc(userId, 'fc_members', { p_circle: circle })) ?? [] },
    async myCode(circle, rotate = false) { return first(await rpc(userId, 'fc_my_code', { p_circle: circle, p_rotate: rotate })) },
    async preview(code) {
      const n = normCode(code)
      if (!n) return { status: 'invalid' }
      return first(await rpc(userId, 'fc_preview', { p_code: n })) ?? { status: 'invalid' }
    },
    async join(code) {
      const n = normCode(code)
      if (!n) return { status: 'invalid' }
      return first(await rpc(userId, 'fc_join', { p_code: n })) ?? { status: 'invalid' }
    },
    leave: (circle) => rpc(userId, 'fc_leave', { p_circle: circle }),
    decide: (circle, user, approve) => rpc(userId, 'fc_decide', { p_circle: circle, p_user: user, p_approve: Boolean(approve) }),
    remove: (circle, user) => rpc(userId, 'fc_remove', { p_circle: circle, p_user: user }),
    async codes(circle) { return (await rpc(userId, 'fc_codes', { p_circle: circle })) ?? [] },
    revokeCode: (codeId) => rpc(userId, 'fc_revoke_code', { p_code_id: codeId }),
    transfer: (circle, user) => rpc(userId, 'fc_transfer', { p_circle: circle, p_user: user }),
    remove_circle: (circle) => rpc(userId, 'fc_delete', { p_circle: circle }),
    async disciplines(circle) { return (await rpc(userId, 'fc_rating_catalog', { p_circle: circle, p_all: true })) ?? [] },
    saveDiscipline: (circle, exerciseId, splitBySex, enabled) => rpc(userId, 'fc_save_discipline', {
      p_circle: circle, p_exercise_id: exerciseId, p_split_by_sex: Boolean(splitBySex), p_enabled: Boolean(enabled),
    }),
  }
}
