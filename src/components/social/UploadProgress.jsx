import { fmtNum } from '../../lib/metric.js'

// Сколько вложений уже ушло (19.10.2026, fb_5ef64577): видео 10–20 МБ на мобильной связи идет минутами,
// а одна надпись «Отправляю…» не говорила, движется ли что-то. Полоса и «5,1 из 12,4 МБ».
// progress — { loaded, total } в байтах; меньше мегабайта (картинки) — не показываем, это доли секунды.
const MB = 1024 * 1024
const mb = (b) => fmtNum((Math.floor((b / MB) * 10) / 10).toFixed(1))

export default function UploadProgress({ progress }) {
  if (!progress || !(progress.total >= MB)) return null
  const pct = Math.max(0, Math.min(100, Math.round((progress.loaded / progress.total) * 100)))
  return (
    <div className="fb-upload" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
      aria-label="Загрузка вложений">
      <div className="fb-upload-bar"><div className="fb-upload-fill" style={{ width: `${pct}%` }} /></div>
      <span className="fb-upload-cap">
        {pct >= 100 ? 'Вложения загружены, отправляю обращение' : `Загружено ${mb(progress.loaded)} из ${mb(progress.total)} МБ`}
      </span>
    </div>
  )
}
