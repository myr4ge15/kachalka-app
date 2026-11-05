import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('иконки установки PWA', () => {
  for (const prefix of ['', 'beta-']) {
    for (const [name, size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180]]) {
      it(`${prefix}${name}: непрозрачный квадрат без прозрачных углов`, () => {
        const png = readFileSync(new URL(`../../public/${prefix}${name}`, import.meta.url))
        expect(png.subarray(1,4).toString()).toBe('PNG')
        expect(png.readUInt32BE(16)).toBe(size)
        expect(png.readUInt32BE(20)).toBe(size)
        // PNG truecolor RGB, без alpha-канала и ключа прозрачности tRNS.
        expect(png[25]).toBe(2)
        for (let offset=8; offset<png.length;) {
          const length=png.readUInt32BE(offset)
          expect(png.toString('ascii',offset+4,offset+8)).not.toBe('tRNS')
          offset += length+12
        }
      })
    }
  }
})
