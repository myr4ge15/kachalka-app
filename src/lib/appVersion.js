// Версия из package.json, прокинутая через vite define. Fallback на случай
// запуска без define (напр. тесты) — чтобы не падать на ReferenceError.
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

// Бета-стенд (VITE_BETA=1, .github/workflows/beta.yml): пометка «БЕТА» в шапке, чтобы копию
// на отдельном домене не спутать с приложением друзей.
export const IS_BETA = import.meta.env?.VITE_BETA === '1'
