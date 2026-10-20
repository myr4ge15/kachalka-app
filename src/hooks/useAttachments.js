import { useCallback, useEffect, useRef, useState } from 'react'
import { isVideoFile } from '../lib/feedback.js'
import { videoPoster as defaultPoster } from '../lib/videoPoster.js'

// Вложения обращения с предзагрузкой (20.10.2026): файл уходит в Storage сразу после выбора, а не
// по «Отправить». На миниатюре — прогресс, ошибка с «Повторить», крестик (отменяет и удаляет уже
// загруженное). «Отправить» ждет догрузки (readyPaths) и шлет только пути.
// Ушли с экрана или нажали «Отмена», не отправив, — загруженное удаляется (discard); что не успели
// удалить (закрыли приложение) — подчистит сервер (Edge feedback-cleanup, раз в час, старше суток).
//
// api — { upload(userId, file, { onBytes }) → path, discard(paths) }; может пересоздаваться на каждом
// рендере — держим в ref. poster(file) → dataURL|null — кадр видео для миниатюры.
// Элемент: { key, file, video, status: 'uploading'|'done'|'error', loaded, total, path, poster, error }.
export function useAttachments(userId, api, { poster = defaultPoster } = {}) {
  const [items, setItems] = useState([])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const apiRef = useRef(api)
  apiRef.current = api
  const alive = useRef(true)
  const dropped = useRef(new Set()) // убранные, пока шла загрузка: путь — сразу в discard
  const pending = useRef(new Map()) // key → промис загрузки (для readyPaths)
  const seq = useRef(0)
  // Статус и путь каждого элемента — еще и здесь, синхронно: readyPaths не ждет, пока React
  // применит последние setItems. Порядок вставки = порядок миниатюр.
  const live = useRef(new Map())

  const patch = useCallback((key, p) => {
    const cur = live.current.get(key)
    if (cur && (p.status || p.path)) live.current.set(key, { ...cur, ...(p.status && { status: p.status }), ...(p.path && { path: p.path }) })
    if (alive.current) setItems((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)))
  }, [])
  const discard = useCallback((paths) => { if (paths.length) apiRef.current?.discard(paths) }, [])

  const start = useCallback((item) => {
    const run = Promise.resolve()
      .then(() => apiRef.current.upload(userId, item.file, { onBytes: (b) => patch(item.key, { loaded: b }) }))
      .then((path) => {
        if (dropped.current.has(item.key) || !alive.current) { discard([path]); return }
        patch(item.key, { status: 'done', path, loaded: item.total })
      })
      .catch((e) => { patch(item.key, { status: 'error', error: e?.message || 'Не загрузилось' }) })
      .finally(() => pending.current.delete(item.key))
    pending.current.set(item.key, run)
  }, [userId, patch, discard])

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
