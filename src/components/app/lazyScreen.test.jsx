// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { Suspense, useEffect, Component } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { lazyScreen } from './lazyScreen.jsx'

const Hello = ({ name }) => <p>Привет, {name}</p>
const mod = { default: Hello }

// Screen передаем элементом, а не компонентом: ESLint без react-плагина
// не видит JSX-использование параметра.
function mount(el) {
  return render(<Suspense fallback={<p>загрузка</p>}>{el}</Suspense>)
}

describe('lazyScreen', () => {
  it('после preload рендерится сразу, без Suspense-фолбэка', async () => {
    const Screen = lazyScreen(() => Promise.resolve(mod))
    await Screen.preload()
    mount(<Screen name="Андрюша" />)
    expect(screen.getByText('Привет, Андрюша')).toBeInTheDocument()
    expect(screen.queryByText('загрузка')).toBeNull()
  })

  it('без preload ведет себя как обычный lazy', async () => {
    const Screen = lazyScreen(() => Promise.resolve(mod))
    mount(<Screen name="Андрюша" />)
    expect(screen.getByText('загрузка')).toBeInTheDocument()
    expect(await screen.findByText('Привет, Андрюша')).toBeInTheDocument()
  })

  it('фабрику зовет один раз на префетч и рендер', async () => {
    const factory = vi.fn(() => Promise.resolve(mod))
    const Screen = lazyScreen(factory)
    Screen.preload()
    mount(<Screen name="Андрюша" />)
    await screen.findByText('Привет, Андрюша')
    await Screen.preload()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('экран, смонтированный до загрузки, не перемонтируется после нее', async () => {
    let mounts = 0
    const Counted = () => {
      useEffect(() => { mounts++ }, [])
      return <p>готово</p>
    }
    const Screen = lazyScreen(() => Promise.resolve({ default: Counted }))
    const ui = (n) => (
      <Suspense fallback={<p>загрузка</p>}><Screen n={n} /></Suspense>
    )
    const { rerender } = render(ui(1))
    await screen.findByText('готово')
    rerender(ui(2))
    expect(screen.getByText('готово')).toBeInTheDocument()
    expect(mounts).toBe(1)
  })

  it('упавший РЕНДЕР не залипает: повторное монтирование («Попробовать снова») грузит заново', async () => {
    const factory = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('net')))
      .mockImplementation(() => Promise.resolve(mod))
    const Screen = lazyScreen(factory)
    class Boundary extends Component {
      state = { failed: false }
      static getDerivedStateFromError() { return { failed: true } }
      render() {
        return this.state.failed
          ? <button onClick={() => this.setState({ failed: false })}>снова</button>
          : this.props.children
      }
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Boundary><Suspense fallback={<p>загрузка</p>}><Screen name="Андрюша" /></Suspense></Boundary>)
    const again = await screen.findByText('снова')
    // Человек нажимает не мгновенно (lazyScreen ждет RETRY_AFTER_MS = 300 мс по
    // Date.now). Сдвигаем часы, а не спим реальные 350 мс.
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 350)
    fireEvent.click(again)
    expect(await screen.findByText('Привет, Андрюша')).toBeInTheDocument()
    expect(factory).toHaveBeenCalledTimes(2)
    spy.mockRestore()
    vi.mocked(Date.now).mockRestore()
  })

  it('упавшая загрузка не залипает: повторный preload снова зовет import', async () => {
    const factory = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('net')))
      .mockImplementation(() => Promise.resolve(mod))
    const Screen = lazyScreen(factory)
    await expect(Screen.preload()).rejects.toThrow('net')
    await Screen.preload()
    mount(<Screen name="Андрюша" />)
    expect(screen.getByText('Привет, Андрюша')).toBeInTheDocument()
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
