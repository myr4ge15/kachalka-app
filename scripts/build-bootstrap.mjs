#!/usr/bin/env node
// ============================================================================
// Склейка SQL-канонов в один прогоняемый файл (шаг 0, PLAN-public-instance).
//
// Порядок берётся из supabase/bootstrap/order.txt — там же объяснение, почему он
// такой. Каноны НЕ копируются в репозиторий: один канон на функцию, одно место с
// порядком. Результат (bootstrap.sql) — генерируемый артефакт, руками не править.
//
//   node scripts/build-bootstrap.mjs [--out путь] [--split [КБ]]
//
// --split нарезает результат на куски под Supabase SQL Editor (он не принимает
// файл целиком): parts/part-NN.sql, разрыв ТОЛЬКО на границе исходных файлов —
// внутри канона резать нельзя, там многострочные функции в $$. Дефолт 100 КБ.
//
// Скрипт ничего не деплоит и никуда не ходит: читает файлы, пишет файлы.
// ============================================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sqlDir = join(root, 'supabase')
const orderFile = join(sqlDir, 'bootstrap', 'order.txt')

const outArg = process.argv.indexOf('--out')
const outFile = outArg > -1 && process.argv[outArg + 1]
  ? resolve(process.argv[outArg + 1])
  : join(sqlDir, 'bootstrap', 'bootstrap.sql')

if (!existsSync(orderFile)) {
  // supabase/ git-ignored — в чистом клоне его может не быть. Это не поломка
  // сборки приложения: скрипт запускают руками, когда поднимают бэкенд.
  console.error(`Нет ${orderFile}. Каталог supabase/ отсутствует в этом клоне?`)
  process.exit(1)
}

const files = readFileSync(orderFile, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))

const missing = files.filter((f) => !existsSync(join(sqlDir, f)))
if (missing.length) {
  console.error('Файлы из order.txt не найдены:\n  ' + missing.join('\n  '))
  process.exit(1)
}

const stamp = new Date().toISOString()
const parts = [
  '-- ============================================================================',
  '-- СГЕНЕРИРОВАНО scripts/build-bootstrap.mjs — НЕ ПРАВИТЬ РУКАМИ.',
  '-- Правки вносить в исходный канон в supabase/ и/или в bootstrap/order.txt.',
  `-- Собрано: ${stamp}`,
  `-- Файлов в последовательности: ${files.length}`,
  '--',
  '-- Порядок и обоснование каждой позиции — supabase/bootstrap/README.md.',
  '-- Канон функции применяется ПОСЛЕДНИМ из тех, кто её трогает: прогон с',
  '-- откаченным каноном проходит без единой ошибки и ломает прод молча.',
  '-- ============================================================================',
  '',
]

// Блок на каждый исходный файл — неделимая единица: внутри канона многострочные
// функции в $$ ... $$, резать их нельзя.
const blocks = files.map((f, i) => ({
  file: f,
  n: i + 1,
  text: [
    '',
    '-- ' + '='.repeat(74),
    `-- [${String(i + 1).padStart(2, '0')}/${files.length}] ${f}`,
    '-- ' + '='.repeat(74),
    '',
    readFileSync(join(sqlDir, f), 'utf8').replace(/\s+$/, ''),
    '',
  ].join('\n'),
}))

const sql = parts.join('\n') + blocks.map((b) => b.text).join('\n')
writeFileSync(outFile, sql, 'utf8')
const kb = (n) => Math.round(n / 1024)
console.log(`Собрано ${files.length} файлов → ${outFile} (${kb(sql.length)} КБ)`)

// ---- Нарезка под SQL Editor -----------------------------------------------
const splitArg = process.argv.indexOf('--split')
if (splitArg > -1) {
  const limit = (Number(process.argv[splitArg + 1]) || 100) * 1024
  const partsDir = join(dirname(outFile), 'parts')
  // Чистим прошлую нарезку, но не падаем, если файлы заблокированы (открыты в
  // редакторе, сетевой диск): куски всё равно перезапишутся, а лишние снимем ниже.
  try { rmSync(partsDir, { recursive: true, force: true }) } catch { /* перезапишем */ }
  mkdirSync(partsDir, { recursive: true })

  const chunks = []
  let cur = []
  let size = 0
  for (const b of blocks) {
    // Файл крупнее лимита кладём в свой кусок целиком: лучше один большой кусок,
    // чем разрезанная посередине функция.
    if (cur.length && size + b.text.length > limit) {
      chunks.push(cur)
      cur = []
      size = 0
    }
    cur.push(b)
    size += b.text.length
  }
  if (cur.length) chunks.push(cur)

  chunks.forEach((chunk, i) => {
    const no = String(i + 1).padStart(2, '0')
    const head = [
      '-- ' + '='.repeat(74),
      `-- СГЕНЕРИРОВАНО. Кусок ${i + 1} из ${chunks.length}.`,
      `-- Прогонять СТРОГО ПО ПОРЯДКУ: part-01 → part-${String(chunks.length).padStart(2, '0')}.`,
      '-- Внутри куска:',
      ...chunk.map((b) => `--   [${String(b.n).padStart(2, '0')}/${files.length}] ${b.file}`),
      '-- ' + '='.repeat(74),
      '',
    ].join('\n')
    const body = head + chunk.map((b) => b.text).join('\n')
    writeFileSync(join(partsDir, `part-${no}.sql`), body, 'utf8')
    console.log(`  part-${no}.sql — ${kb(body.length)} КБ, файлов: ${chunk.length}`)
  })
  // Хвосты от прошлой, более длинной нарезки: прогонять их нельзя, порядок собьётся.
  for (let i = chunks.length; i < chunks.length + 20; i++) {
    const stale = join(partsDir, `part-${String(i + 1).padStart(2, '0')}.sql`)
    if (existsSync(stale)) {
      try { rmSync(stale) } catch { console.warn(`  ⚠ не удалось убрать устаревший ${stale} — удалить вручную`) }
    }
  }
  console.log(`\nНарезано на ${chunks.length} кусков → ${partsDir}`)
  console.log('SQL Editor: прогонять строго по порядку, следующий — только если предыдущий без ошибок.')
} else {
  console.log('Дальше: psql -v ON_ERROR_STOP=1 -f ... либо --split для SQL Editor.')
}
