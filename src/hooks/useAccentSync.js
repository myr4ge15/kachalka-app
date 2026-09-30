import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getAccentPref } from '../db/repo.js'
import {
  DEFAULT_ACCENT, applyAccent, loadAccent, loadAccentOwner, parseAccent, sameAccent, saveAccent,
} from '../lib/accent.js'

// Синк акцента между устройствами одной учетки (v6.2.0, переделан в v6.2.4).
//
// Источник правды после входа — род `accent` в персональной meta (синк через
// user_meta, LWW). Принимаем значение ТОЛЬКО со своим владельцем (`by === userId`):
//  • v6.2.0 заливал в учетку «найденный на устройстве» выбор — на общем телефоне
//    это был цвет ДРУГОЙ учетки, и он разъезжался по ее устройствам. Такие
//    значения без `by` игнорируются; автозаливки больше нет — в учетку пишет
//    только явный выбор в «Оформлении» (repo.setAccentPref).
//  • Своего значения нет, а на устройстве лежит цвет чужой учетки (или «ничей»
//    из старой версии) — возвращаем вольт, а не показываем чужой цвет.
// Примененное кладем в localStorage с владельцем — сплэш следующего запуска.
export function useAccentSync(userId, {
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  root = typeof document !== 'undefined' ? document.documentElement : null,
} = {}) {
  const remote = useLiveQuery(() => (userId ? getAccentPref(userId) : null), [userId], undefined)
  useEffect(() => {
    if (!userId || remote === undefined) return
    const mine = remote && typeof remote === 'object' && remote.by === String(userId)
    if (mine) {
      const next = parseAccent(JSON.stringify(remote))
      if (!sameAccent(next, loadAccent(storage)) || loadAccentOwner(storage) !== String(userId)
        || root?.dataset?.accent !== next.id) {
        applyAccent(root, next)
        saveAccent(storage, next, userId)
      }
      return
    }
    // Своего выбора в учетке нет: свой локальный (сделан на этом устройстве) —
    // оставляем, чужой или «ничей» — сбрасываем на дефолт.
    if (loadAccentOwner(storage) !== String(userId)) {
      const def = { id: DEFAULT_ACCENT, hue: loadAccent(storage).hue }
      if (!sameAccent(def, loadAccent(storage)) || root?.dataset?.accent !== DEFAULT_ACCENT) {
        applyAccent(root, def)
      }
      saveAccent(storage, def)
    }
  }, [userId, remote, storage, root])
}
