// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const mocks=vi.hoisted(()=>({ save:vi.fn(),catalog:{items:[{id:'d',exercise_id:'e1',name:'Жим',metric:'weight',split_by_sex:true}]} }))
vi.mock('dexie-react-hooks',()=>({useLiveQuery:fn=>fn()}))
vi.mock('../../db/disciplines.js',()=>({getRatingCatalog:()=>mocks.catalog,fetchRatingCatalog:vi.fn().mockResolvedValue()}))
vi.mock('../../lib/adminDisciplines.js',()=>({adminSaveDiscipline:(...args)=>mocks.save(...args)}))
import AdminDisciplines from './AdminDisciplines.jsx'
const exercises=[{id:'e1',name:'Жим'},{id:'e2',name:'Планка'},{id:'e3',name:'Скрытое',is_hidden:true}]
beforeEach(()=>{mocks.save.mockReset().mockResolvedValue({refreshed:true})})
describe('управление дисциплинами',()=>{
  it('добавляет выбранное упражнение, исключает скрытые и уже добавленные',async()=>{
    const user=userEvent.setup();render(<AdminDisciplines userId="admin" exercises={exercises} online />)
    expect(screen.queryByRole('option',{name:'Скрытое'})).toBeNull()
    expect(screen.queryByRole('option',{name:'Жим'})).toBeNull()
    await user.selectOptions(screen.getByRole('combobox',{name:'Упражнение'}),'e2')
    await user.click(screen.getByRole('button',{name:'Добавить дисциплину'}))
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith('admin',{exercise_id:'e2',split_by_sex:true}))
  })
  it('убрать — выключить дисциплину, без удаления тренировок',async()=>{
    const user=userEvent.setup();render(<AdminDisciplines userId="admin" exercises={exercises} online />)
    await user.click(screen.getByRole('button',{name:'Убрать из рейтинга: Жим'}))
    expect(mocks.save).toHaveBeenCalledWith('admin',expect.objectContaining({exercise_id:'e1',enabled:false}))
  })
  it('«по полу» и ✕ видны сразу, список не пропадает; ошибка — откат (fb_c6b5ce77)',async()=>{
    let done;mocks.save.mockImplementation(()=>new Promise(r=>{done=r}))
    const user=userEvent.setup();render(<AdminDisciplines userId="admin" exercises={exercises} online />)
    const chip=within(screen.getByRole('list')).getByRole('checkbox',{name:'Раздельно по полу'})
    await user.click(chip)
    expect(within(screen.getByRole('list')).getByRole('checkbox',{name:'Раздельно по полу'})).not.toBeChecked()
    expect(screen.getByRole('button',{name:'Добавить дисциплину'})).toHaveTextContent('Добавить') // не «Сохраняю…»
    done({refreshed:true})
    await waitFor(()=>expect(screen.getByRole('button',{name:'Убрать из рейтинга: Жим'})).not.toBeDisabled())
    // после успеха чип не прыгает обратно к старому снимку, пока тот не обновился
    expect(within(screen.getByRole('list')).getByRole('checkbox',{name:'Раздельно по полу'})).not.toBeChecked()
    mocks.save.mockRejectedValueOnce(new Error('нет'))
    await user.click(screen.getByRole('button',{name:'Убрать из рейтинга: Жим'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('нет')
    expect(screen.getByRole('button',{name:'Убрать из рейтинга: Жим'})).toBeInTheDocument()
    // откат — к снимку каталога
    expect(within(screen.getByRole('list')).getByRole('checkbox',{name:'Раздельно по полу'})).toBeChecked()
  })
  it('ширина чипа «по полу» не меняется: галочка в разметке всегда (fb_c6b5ce77)',()=>{
    render(<AdminDisciplines userId="admin" exercises={exercises} online />)
    for (const chip of document.querySelectorAll('.disc-sex')) expect(chip.querySelector('.disc-sex-ico')).not.toBeNull()
  })
  it('офлайн нельзя менять конфигурацию',()=>{
    render(<AdminDisciplines userId="admin" exercises={exercises} online={false} />)
    expect(screen.getByRole('button',{name:'Убрать из рейтинга: Жим'})).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
