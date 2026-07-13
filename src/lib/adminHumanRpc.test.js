import { describe, it, expect } from 'vitest'
import { humanRpc } from './adminMessages.js'

// Табличный тест маппинга серверных raise → человекочитаемых сообщений. Защищает
// от тихого дрейфа: при смене серверной строки без обновления маппинга тест упадёт,
// а не покажет пользователю сырой код.
describe('admin.humanRpc', () => {
  const cases = [
    ['admin only', 'Нужны права админа.'],
    ['permission denied (42501)', 'Нужны права админа.'],
    ['cannot remove last admin', 'Нельзя снять роль с последнего админа.'],
    ['user not found', 'Запись не найдена.'],
    ['name length 1..60', 'Название — от 1 до 60 символов.'],
    ['name length 1..40', 'Имя — от 1 до 40 символов.'],
    ['function admin_x does not exist', 'Сервер не готов: обнови серверную часть.'],
    ['no schema', 'Сервер не готов: обнови серверную часть.'],
  ]
  it.each(cases)('«%s» → «%s»', (input, expected) => {
    expect(humanRpc(input)).toBe(expected)
  })

  it('неизвестное сообщение возвращается как есть', () => {
    expect(humanRpc('какая-то новая ошибка')).toBe('какая-то новая ошибка')
  })

  it('пустое/undefined → дефолтная фраза', () => {
    expect(humanRpc('')).toBe('Не удалось выполнить операцию.')
    expect(humanRpc(undefined)).toBe('Не удалось выполнить операцию.')
  })
})
