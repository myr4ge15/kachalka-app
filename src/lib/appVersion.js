// Версия из package.json, прокинутая через vite define. Fallback на случай
// запуска без define (напр. тесты) — чтобы не падать на ReferenceError.
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
