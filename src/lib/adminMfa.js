// 2FA (TOTP) для Админки (v6.14.0, supabase/admin-mfa.sql).
//
// Встроенная MFA Supabase Auth поверх нашей сессии-моста: админ включает защиту
// (QR → приложение-аутентификатор → первый код), дальше перед Админкой просим код
// и поднимаем сессию до aal2. Решает СЕРВЕР: is_admin() и Edge admin-* не пускают
// сессию aal1, если у учетки есть подтвержденный фактор. Этот модуль — только
// удобство (не показывать Админку, которая все равно откажет) и онлайн-операции.
// Как приглашения и обращения — вне очередей синка.
//
// `auth` подставляется (по умолчанию supabase.auth) — для тестов.
import { supabase } from '../db/supabase.js'

export class MfaError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MfaError'
    this.code = code // 'bad_code' | 'disabled' | 'network' | 'server'
  }
}

const ISSUER = 'Журнал тренировок'
const FRIENDLY = 'Админка'

function mfaError(error) {
  const code = String(error?.code ?? '')
  const msg = String(error?.message ?? '')
  if (/mfa_verification_failed|invalid.*code|invalid totp|expired/i.test(code + ' ' + msg)) {
    return new MfaError('bad_code', 'Код не подошел. Проверь время на телефоне и введи свежий код.')
  }
  if (/mfa_.*(not_enabled|disabled)|enroll.*disabled/i.test(code + ' ' + msg)) {
    return new MfaError('disabled', 'В Supabase выключен TOTP: Authentication → Multi-Factor → включить TOTP.')
  }
  if (/fetch|network|Failed to fetch|timeout/i.test(msg)) {
    return new MfaError('network', 'Нет сети — попробуй позже.')
  }
  return new MfaError('server', msg || 'Не получилось. Попробуй еще раз.')
}

async function call(p) {
  let res
  try { res = await p } catch (e) { throw mfaError(e) }
  if (res?.error) throw mfaError(res.error)
  return res?.data ?? null
}

// Состояние защиты для текущей сессии.
//   enabled   — есть подтвержденный TOTP-фактор;
//   level     — 'aal1' | 'aal2' (подтверждена ли ЭТА сессия кодом);
//   pending   — id неподтвержденных факторов (брошенное включение).
export async function mfaState(auth = supabase.auth) {
  const [factors, aal] = await Promise.all([
    call(auth.mfa.listFactors()),
    call(auth.mfa.getAuthenticatorAssuranceLevel()),
  ])
  const totp = (factors?.all ?? []).filter((f) => f?.factor_type === 'totp')
  const verified = totp.find((f) => f.status === 'verified') ?? null
  return {
    enabled: Boolean(verified),
    factorId: verified?.id ?? null,
    level: aal?.currentLevel === 'aal2' ? 'aal2' : 'aal1',
    pending: totp.filter((f) => f.status !== 'verified').map((f) => f.id),
  }
}

// Нужно ли спросить код, прежде чем показать Админку.
export const needsCode = (st) => Boolean(st?.enabled && st.level !== 'aal2')

// 6 цифр из ввода (пробелы и прочее отбрасываем — так копирует часть приложений).
export const cleanCode = (s) => String(s ?? '').replace(/\D/g, '').slice(0, 6)

// Подтвердить сессию кодом (и первый код при включении — тот же вызов).
export async function verifyCode(factorId, code, auth = supabase.auth) {
  const c = cleanCode(code)
  if (c.length !== 6) throw new MfaError('bad_code', 'Код — 6 цифр из приложения.')
  await call(auth.mfa.challengeAndVerify({ factorId, code: c }))
  return true
}

// Начать включение: убрать брошенные неподтвержденные факторы (иначе Supabase
// откажет повтору), завести новый. Возвращает QR (svg data URI) и секрет для ручного ввода.
export async function startEnroll(state, auth = supabase.auth) {
  for (const id of state?.pending ?? []) {
    await call(auth.mfa.unenroll({ factorId: id }))
  }
  const data = await call(auth.mfa.enroll({ factorType: 'totp', friendlyName: FRIENDLY, issuer: ISSUER }))
  return { factorId: data.id, qr: data.totp?.qr_code ?? null, secret: data.totp?.secret ?? '' }
}

// Отключить (Supabase позволяет только сессии aal2 — укравший PIN не снимет).
export async function disableMfa(factorId, auth = supabase.auth) {
  await call(auth.mfa.unenroll({ factorId }))
  return true
}

// Секрет для ручного ввода — группами по 4, читать проще.
export const groupSecret = (s) => String(s ?? '').replace(/(.{4})/g, '$1 ').trim()
