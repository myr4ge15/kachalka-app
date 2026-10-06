import { useEffect, useRef } from 'react'

// Гард от setState после размонтирования (v6.14.1, вынесен из ProfileScreen): async-
// обработчики (загрузка аватара, RPC смены имени/PIN, удаление данных, повтор/отклонение
// dead-letter) делают setState уже ПОСЛЕ await — уход с экрана в процессе иначе дает
// React-варн «update on unmounted». ref.current === false — компонент уже снят.
export function useAliveRef() {
  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])
  return aliveRef
}
