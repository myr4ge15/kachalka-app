import { useState } from 'react'
import { clearSwipeLog, readSwipeLog, swipeLogLine } from '../../lib/swipeLog.js'

// Журнал свайпов «назад» этого устройства (23.10.2026, «свайп прыгает»): что видел жест — исход, сдвиг, скорость,
// число точек, почему прервался. Только чтение localStorage (lib/swipeLog.js), кнопка «Очистить».
export default function SwipeLog() {
  const [list, setList] = useState(() => readSwipeLog())
  return (
    <section className="sec">
      <p className="admin-hint">
        Последние свайпы «назад» на этом телефоне. «вернулся» — жест не дотянул до трети экрана и не был броском
        (порог 0,3 px/мс); «прерван» — жест оборвала система или второй палец.
      </p>
      {list.length === 0 ? (
        <p className="muted">Пока пусто — сделай пару свайпов «назад» и открой раздел снова.</p>
      ) : (
        <ol className="swipe-log">
          {list.map((e, i) => <li key={i}>{swipeLogLine(e)}</li>)}
        </ol>
      )}
      {list.length > 0 && (
        <button type="button" className="btn ghost" onClick={() => { clearSwipeLog(); setList([]) }}>Очистить</button>
      )}
    </section>
  )
}
