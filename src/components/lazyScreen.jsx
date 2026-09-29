import { lazy, useState } from 'react'

// Ленивый экран с префетчем, который РЕАЛЬНО убирает заглушку.
//
// Голый React.lazy узнаёт о загрузке модуля только от собственного вызова фабрики
// при первом рендере: даже если чанк давно подтянут префетчем, первый рендер всё
// равно получает новый pending-промис import() и уходит в Suspense. А React 19
// держит однажды показанный фолбэк не меньше ~300 мс (throttle раскрытия
// Suspense) — отсюда «пустой экран → скелетон → контент» при первом заходе на
// каждую вкладку после холодного старта, хотя всё уже в памяти. Повторный заход
// мгновенный: lazy к тому моменту уже resolved.
//
// Здесь preload() и lazy делят ОДИН промис, а готовый компонент запоминается:
// после префетча экран рендерится напрямую, минуя lazy и Suspense. Упавшая
// загрузка (сеть при холодном кэше) промис сбрасывает — следующая попытка
// повторит import, а не залипнет на ошибке.
export function lazyScreen(factory) {
  let Loaded = null
  let pending = null
  const preload = () => {
    pending ??= factory().then(
      (mod) => { Loaded = mod.default; return mod },
      (err) => { pending = null; throw err }
    )
    return pending
  }
  const Lazy = lazy(preload)
  // Выбор фиксируем на жизнь экземпляра: экран, смонтированный через lazy, при
  // догрузке модуля не должен переключиться на Loaded — смена типа элемента
  // перемонтировала бы его с потерей состояния.
  function Screen(props) {
    const [Comp] = useState(() => Loaded ?? Lazy)
    return <Comp {...props} />
  }
  Screen.preload = preload
  return Screen
}
