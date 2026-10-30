import MenuRow from '../ui/MenuRow.jsx'
import { useEffect, useRef, useState } from 'react'

// Кнопка «Выйти» профиля с состоянием занятости (РЕВЬЮ-КОДА-2026-10-02).
// Экран входа открывается сразу, отвязка пушей и signOut дорабатывают в фоне (useSession);
// «Выхожу…», disabled и защита от повторного нажатия (ref — на случай двух тапов до
// перерисовки) остаются на случай сбоя. onLogout может быть синхронным или вернуть промис.
export default function LogoutButton({ onLogout }) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])

  async function click() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await onLogout?.()
    } catch (err) {
      // Сорвался — человек остается в профиле и может нажать еще раз.
      console.warn('Выход не удался:', err)
    } finally {
      // Успешный выход размонтирует профиль — сбрасываем только если экран жив
      // (например, выход сорвался и человек остался на месте).
      busyRef.current = false
      if (aliveRef.current) setBusy(false)
    }
  }

  return (
    <MenuRow kind="action" tone="danger" icon="logout" className="logout" title={busy ? 'Выхожу…' : 'Выйти'}
      onClick={click} disabled={busy} aria-busy={busy || undefined} />
  )
}
