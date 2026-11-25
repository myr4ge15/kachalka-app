import { showToast } from '../ui/Toast.jsx'

export default function ShareInviteButton({ text, className }) {
  async function share() {
    let data = { title: 'kachalka-app', text }
    try {
      if (navigator.canShare) {
        // Файл готовим в самом нажатии: Safari требует пользовательский жест для share().
        const bytes = Uint8Array.from(atob(import.meta.env.INVITE_CARD_BASE64), (char) => char.charCodeAt(0))
        const file = new File([bytes], 'kachalka-app.png', { type: 'image/png' })
        const withPhoto = { ...data, files: [file] }
        if (navigator.canShare(withPhoto)) data = withPhoto
      }
      await navigator.share(data)
    } catch (error) {
      if (error?.name !== 'AbortError') showToast({ icon: 'alert', title: 'Не удалось поделиться', sub: 'Нажми «Скопировать», чтобы отправить приглашение текстом.' })
    }
  }

  return <button type="button" className={className} onClick={share}>Поделиться</button>
}
