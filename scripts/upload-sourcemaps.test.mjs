import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { uploadSourceMaps } from './upload-sourcemaps.mjs'

const token = btoa(JSON.stringify({ integrationId: '00000000-0000-4000-8000-000000000001', secret: '00000000-0000-4000-8000-000000000002' }))

test('Hawk release: token, beta version, base, files and rejected responses', async () => {
  const buildDir = await mkdtemp(path.join(tmpdir(), 'kachalka-hawk-'))
  try {
    await mkdir(path.join(buildDir, 'assets'))
    await writeFile(path.join(buildDir, 'version.json'), JSON.stringify({ version: '1.9.3-beta.7' }))
    await assert.rejects(uploadSourceMaps({ token: '', buildDir }), /TOKEN/)
    await assert.rejects(uploadSourceMaps({ token, buildDir }), /source maps/)
    await writeFile(path.join(buildDir, 'assets', 'app.js.map'), '{"version":3}')
    await writeFile(path.join(buildDir, 'assets', 'app.js'), 'code')
    const calls = []
    const fetchFn = async (url, init) => {
      calls.push({ url, init })
      return { ok: true, json: async () => ({ error: false }) }
    }
    assert.equal(await uploadSourceMaps({ token, buildDir, base: '/app/', fetchFn }), 1)
    assert.equal(calls.length, 1)
    const { url, init } = calls[0]
    assert.equal(url, 'https://00000000-0000-4000-8000-000000000001.k1.hawk.so/release')
    assert.equal(init.headers.Authorization, `Bearer ${token}`)
    assert.equal(init.body.get('release'), '1.9.3-beta.7')
    assert.equal(init.body.get('file').name, '/app/assets/app.js.map')
    assert.equal(await init.body.get('file').text(), '{"version":3}')
    await assert.rejects(uploadSourceMaps({ token, buildDir, fetchFn: async () => ({ ok: false, status: 401 }) }), /HTTP 401/)
    await assert.rejects(uploadSourceMaps({ token, buildDir, fetchFn: async () => ({ ok: true, json: async () => ({ error: true }) }) }), /не подтвердил/)
    await assert.rejects(uploadSourceMaps({ token, buildDir, fetchFn: async () => { throw new Error('offline') } }), /offline/)
  } finally {
    await rm(buildDir, { recursive: true, force: true })
  }
})
