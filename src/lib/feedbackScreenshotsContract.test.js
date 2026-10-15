import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
const source = new URL('../../supabase/functions/feedback/logic.ts', import.meta.url)
const parseRequest = existsSync(source) ? (await import(source.href)).parseRequest : null
const id = '00000000-0000-0000-0000-000000000001'
const path = id + '/' + id + '.jpg'
it.skipIf(!parseRequest)('новый контракт принимает несколько фото и чтение по индексу, отвергает некорректные данные', () => {
  expect(parseRequest({ action: 'submit_screenshots', body: 'a', screenshots: [path, path] })).toMatchObject({ action: 'submit', screenshots: [path, path] })
  expect(parseRequest({ action: 'attach', id, screenshots: [path] })).toMatchObject({ action: 'attach' })
  for (const screenshots of [[], Array(6).fill(path), ['../../secret'], [null], 'bad']) {
    expect(parseRequest({ action: 'attach', id, screenshots })).toHaveProperty('error')
  }
  expect(parseRequest({ action: 'media', id, kind: 'screenshots', n: 4 })).toMatchObject({ n: 4 })
  expect(parseRequest({ action: 'media', id, kind: 'screenshots', n: 5 })).toHaveProperty('error')
})
