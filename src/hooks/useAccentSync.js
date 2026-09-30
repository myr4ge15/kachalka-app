import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getAccentPref, setAccentPref } from '../db/repo.js'
import { applyAccent, hasStoredAccent, loadAccent, parseAccent, sameAccent, saveAccent } from '../lib/accent.js'

// Синк акцента между устройствами (v6.2.0). Источник правды после входа — род
// `accent` в персональной meta (синкается через user_meta, LWW). Этот хук:
//  • значение из meta (своё или пришедшее pull'ом с другого устройства)
//    применяет к <html> и кладёт в localStorage — сплэш следующего запуска
//    (public/accent-boot.js) рисуется уже в нём;
//  • если в meta пусто, а на устройстве есть ЯВНЫЙ выбор (сделан до синка) —
//    заливает его наверх. Дефолт «по отсутствию ключа» не заливаем.
// Экран «Оформление» пишет выбор сам (repo.setAccentPref), хук лишь применяет.
export function useAccentSync(userId, {
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  root = typeof document !== 'undefined' ? document.documentElement : null,
} = {}) {
  const remote = useLiveQuery(() => (userId ? getAccentPref(userId) : null), [userId], undefined)
  useEffect(() => {
    if (!userId || remote === undefined) return
    if (remote == null) {
      if (hasStoredAccent(storage)) setAccentPref(userId, loadAccent(storage)).catch(() => {})
      return
    }
    const next = parseAccent(JSON.stringify(remote))
    if (!sameAccent(next, loadAccent(storage)) || root?.dataset?.accent !== next.id) {
      applyAccent(root, next)
      saveAccent(storage, next)
    }
  }, [userId, remote, storage, root])
}
