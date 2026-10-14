// «Ниже есть еще» (v8.2.1, замечание владельца): в листе подсказки рисунок занимает
// пол-экрана, а текст под ним кончается ровно на краю — что лист листается,
// неочевидно. Хук говорит, остался ли контент ниже видимой части скроллера, и
// дает «прокрутить дальше». Следит за прокруткой и размерами (текст подгружается
// лениво, картинки догружаются — высота меняется без события scroll).
import { useCallback, useEffect, useState } from 'react'

// Порог в пикселях: хвост меньше него — уже «дочитано» (дробные размеры, отступ снизу).
export const MORE_THRESHOLD = 24

export function hasMoreBelow({ scrollTop = 0, clientHeight = 0, scrollHeight = 0 } = {}, threshold = MORE_THRESHOLD) {
  return scrollHeight - (scrollTop + clientHeight) > threshold
}

// ref — скроллер; key — смена содержимого (пересчитать сразу).
export function useScrollMore(ref, key) {
  const [more, setMore] = useState(false)
  // Едем в самый низ по просьбе (scrollToEnd, v8.4.0) — кнопку «ниже» не мигаем,
  // пока не доехали: иначе она вспыхивает на время плавной прокрутки.
  const [toEnd, setToEnd] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const check = () => {
      const left = hasMoreBelow(el)
      setMore(left)
      if (!left) setToEnd(false)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null
    if (ro) {
      ro.observe(el)
      for (const child of el.children) ro.observe(child)
    }
    return () => {
      el.removeEventListener('scroll', check)
      ro?.disconnect()
    }
  }, [ref, key])

  // Прокрутить на ~ две трети экрана: заголовок следующего блока остается в виду.
  const scrollMore = useCallback(() => {
    const el = ref.current
    if (!el) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const top = el.scrollTop + Math.round(el.clientHeight * 0.66)
    if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
    else el.scrollTop = top
  }, [ref])

  // Прокрутить до конца (раскрыли блок в самом низу — «Источники рисунков»):
  // после раскрытия низ уже не виден, и вместо текста всплывала кнопка «ниже».
  const scrollToEnd = useCallback(() => {
    const el = ref.current
    if (!el) return
    setToEnd(true)
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const top = Math.max(0, el.scrollHeight - el.clientHeight)
    if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
    else el.scrollTop = top
  }, [ref])

  return { more: more && !toEnd, scrollMore, scrollToEnd }

}
