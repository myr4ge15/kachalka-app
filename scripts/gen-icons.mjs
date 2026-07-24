// Пересборка PNG-иконок PWA из public/favicon.svg (мастер-вектор).
// Запуск из корня проекта:  npm i -D sharp  &&  node scripts/gen-icons.mjs
// Обновляет: icon-512.png, icon-192.png, apple-touch-icon.png (все в public/).
// Нужен только при смене favicon.svg — иначе иконка установленного PWA остаётся старой.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const svg = readFileSync(resolve('public/favicon.svg'))
const targets = [
  ['icon-512.png', 512],
  ['icon-192.png', 192],
  ['apple-touch-icon.png', 180],
]

for (const [name, size] of targets) {
  // density повыше — чтобы растр из SVG был чётким, затем ресайз в нужный размер
  await sharp(svg, { density: 512 }).resize(size, size).png().toFile(resolve('public', name))
  console.log('written', name, `${size}x${size}`)
}
console.log('done — иконки пересобраны')
