#!/usr/bin/env node
// ============================================================================
// Склейка SQL-канонов в один прогоняемый файл (шаг 0, PLAN-public-instance).
//
// Порядок берётся из supabase/bootstrap/order.txt — там же объяснение, почему он
// такой. Каноны НЕ копируются в репозиторий: один канон на функцию, одно место с
// порядком. Результат (bootstrap.sql) — генерируемый артефакт, руками не править.
//
//   node scripts/build-bootstrap.mjs [--out путь]
//
// Скрипт ничего не деплоит и никуда не ходит: читает файлы, пишет один файл.
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
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

files.forEach((f, i) => {
  const n = String(i + 1).padStart(2, '0')
  parts.push(
    '',
    '-- ' + '='.repeat(74),
    `-- [${n}/${files.length}] ${f}`,
    '-- ' + '='.repeat(74),
    '',
    readFileSync(join(sqlDir, f), 'utf8').replace(/\s+$/, ''),
    ''
  )
})

const sql = parts.join('\n')
writeFileSync(outFile, sql, 'utf8')

const kb = Math.round(sql.length / 1024)
console.log(`Собрано ${files.length} файлов → ${outFile} (${kb} КБ)`)
console.log('Дальше: Supabase → SQL Editor → New query → вставить целиком → Run.')
