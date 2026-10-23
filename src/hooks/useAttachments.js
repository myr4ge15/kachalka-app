import { useCallback, useEffect, useRef, useState } from 'react'
import { isVideoFile } from '../lib/feedback.js'
import { videoPoster as defaultPoster } from '../lib/videoPoster.js'

// Вложения обращения с предзагрузкой (20.10.2026): файл уходит в Storage сразу после выбора, а не
// по «Отправить». На миниатюре — прогресс, ошибка с «Повторить», крестик (отменяет и удаляет уже
// загруженное). «Отправить» ждет догрузки (readyPaths) и шлет только пути.
// Ушли с экрана или нажали «Отмена», не отправив, — загруженное удаляется (discard); что не успели
// удалить (закрыли приложение) — подчистит сервер (Edge feedback-cleanup, раз в час, старше суток).
//
// По очереди и с автоповтором (fb_afd6d919): два видео разом на слабом LTE делили канал, оба срывались в
// «Повторить» и начинали с нуля. Теперь файлы грузятся по одному (остальные ждут с 0%), а обрыв сети,
// зависание и сбой сервера повторяются сами до AUTO_RETRIES раз с паузой; «Повторить» — когда не вышло.
//
// Свернули приложение во время загрузки (fb_37f0c1a8): iOS замораживает PWA, и загрузка рвется. Такой
// обрыв — не попытка: файл ждет возврата в приложение и грузится заново сам, уже загруженные остаются.
//
// api — { upload(userId, file, { onBytes }) → path, discard(paths) }; может пересоздаваться на каждом
// рендере — держим в ref. poster(file) → dataURL|null — кадр видео для миниатюры. wait(ms) — пауза
// перед автоповтором (тест подставляет мгновенную).
// Элемент: { key, file, video, status: 'uploading'|'done'|'error', loaded, total, path, poster, error }.
export const AUTO_RETRIES = 2
export const RETRY_PAUSE_MS = 2000
const RETRYABLE = new Set(['network', 'upload_stalled', 'video_failed', 'shot_failed'])
// После сворачивания вдобавок: пока приложение спало, браузер мог считать себя офлайн, а сессия —
// не успеть продлиться.
const RESUMABLE = new Set([...RETRYABLE, 'offline', 'no_session'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
// Дождаться, когда приложение снова на экране.
function untilVisible() {
  if (!isHidden()) return Promise.resolve()
  return new Promise((resolve) => {
    const on = () => { if (!isHidden()) { document.removeEventListener('visibilitychange', on); resolve() } }
    document.addEventListener('visibilitychange', on)
  })
}

export function useAttachments(userId, api, { poster = defaultPoster, wait = sleep } = {}) {
  const [items, setItems] = useState([])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const apiRef = useRef(api)
  apiRef.current = api
  const alive = useRef(true)
  const dropped = useRef(new Set()) // убранные, пока шла загрузка: путь — сразу в discard
  const pending = useRef(new Map()) // key → промис загрузки (для readyPaths)
  const seq = useRef(0)
  const queue = useRef(Promise.resolve()) // загрузки — по одной
  // Статус и путь каждого элемента — еще и здесь, синхронно: readyPaths не ждет, пока React
  // применит последние setItems. Порядок вставки = порядок миниатюр.
  const live = useRef(new Map())
  const hides = useRef(0) // сколько раз приложение уходило в фон — обрыв «из-за сворачивания»

  useEffect(() => {
    const on = () => { if (isHidden()) hides.current += 1 }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const patch = useCallback((key, p) => {
    const cur = live.current.get(key)
    if (cur && (p.status || p.path)) live.current.set(key, { ...cur, ...(p.status && { status: p.status }), ...(p.path && { path: p.path }) })
    if (alive.current) setItems((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)))
  }, [])
  const discard = useCallback((paths) => { if (paths.length) apiRef.current?.discard(paths) }, [])

  const start = useCallback((item) => {
    const gone = () => dropped.current.has(item.key) || !alive.current
    const attempt = async (n) => {
      const hidesAtStart = hides.current
      try {
        return await apiRef.current.upload(userId, item.file, { onBytes: (b) => patch(item.key, { loaded: b }) })
      } catch (e) {
        // Оборвалось из-за сворачивания — ждем возврата и грузим заново, попытку не считаем.
        if ((hides.current !== hidesAtStart || isHidden()) && RESUMABLE.has(e?.code) && !gone()) {
          await untilVisible()
          if (gone()) throw e
          patch(item.key, { loaded: 0 })
          return attempt(n)
        }
        if (n >= AUTO_RETRIES || !RETRYABLE.has(e?.code) || gone()) throw e
        await wait(RETRY_PAUSE_MS * (n + 1))
        if (gone()) throw e
        patch(item.key, { loaded: 0 })
        return attempt(n + 1)
      }
    }
    const run = queue.current
      .then(async () => {
        if (gone()) return // убрали, пока ждал очереди — и не грузим
        const path = await attempt(0)
        if (gone()) { discard([path]); return }
        patch(item.key, { status: 'done', path, loaded: item.total })
      })
      .catch((e) => { patch(item.key, { status: 'error', error: e?.message || 'Не загрузилось' }) })
      .finally(() => pending.current.delete(item.key))
    queue.current = run
    pending.current.set(item.key, run)
  }, [userId, patch, discard, wait])

  const add = useCallback((files) => {
    const fresh = files.map((file) => ({
      key: `a${++seq.current}`, file, video: isVideoFile(file), status: 'uploading',
      loaded: 0, total: Number(file?.size) || 0, path: null, poster: null, error: '',
    }))
    setItems((list) => [...list, ...fresh])
    for (const item of fresh) {
      live.current.set(item.key, { status: 'uploading', path: null })
      start(item)
      if (item.video) Promise.resolve(poster(item.file)).then((p) => { if (p) patch(item.key, { poster: p }) }, () => {})
    }
  }, [start, poster, patch])

  const remove = useCallback((key) => {
    const item = itemsRef.current.find((x) => x.key === key)
    if (!item) return
    dropped.current.add(key)
    const path = live.current.get(key)?.path
    live.current.delete(key)
    if (path) discard([path])
    setItems((list) => list.filter((x) => x.key !== key))
  }, [discard])

  const retry = useCallback((key) => {
    const item = itemsRef.current.find((x) => x.key === key)
    if (!item || item.status !== 'error') return
    patch(key, { status: 'uploading', loaded: 0, error: '' })
    start(item)
  }, [start, patch])

  // Для «Отправить»: дождаться всех идущих загрузок и вернуть пути по порядку миниатюр;
  // что-то не загрузилось — ошибка с подсказкой.
  const readyPaths = useCallback(async () => {
    while (pending.current.size) await Promise.allSettled([...pending.current.values()])
    const list = [...live.current.values()]
    if (list.some((x) => x.status !== 'done')) throw new Error(NOT_READY)
    return list.map((x) => x.path)
  }, [])

  // Отправлено: файлы теперь принадлежат обращению — забываем, не удаляя.
  const commit = useCallback(() => { itemsRef.current = []; live.current.clear(); setItems([]) }, [])

  // Отмена формы: загруженное удалить, идущие загрузки — удалить по завершении.
  const clear = useCallback(() => {
    for (const k of live.current.keys()) dropped.current.add(k)
    discard(pathsOf(live.current))
    itemsRef.current = []
    live.current.clear()
    setItems([])
  }, [discard])

  // Ушли с экрана — то же, что «Отмена»: идущие загрузки удалят себя сами (alive = false).
  useEffect(() => {
    alive.current = true
    const map = live.current // тот же Map на всю жизнь хука
    return () => {
      alive.current = false
      discard(pathsOf(map))
    }
  }, [discard])

  const uploading = items.filter((x) => x.status === 'uploading').length
  const failed = items.filter((x) => x.status === 'error').length
  // Общий прогресс идущих загрузок — для строки под формой, пока «Отправить» ждет догрузки.
  const progress = uploading
    ? items.reduce((s, x) => ({ loaded: s.loaded + (x.status === 'done' ? x.total : x.loaded), total: s.total + x.total }), { loaded: 0, total: 0 })
    : null
  return { items, add, remove, retry, readyPaths, commit, clear, uploading, failed, progress }
}

const pathsOf = (live) => [...live.values()].map((x) => x.path).filter(Boolean)

export const NOT_READY = 'Не все вложения загрузились: нажми «Повторить» на миниатюре или убери их.'
