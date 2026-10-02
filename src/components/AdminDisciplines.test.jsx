// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const mocks=vi.hoisted(()=>({ save:vi.fn(),catalog:{items:[{id:'d',exercise_id:'e1',name:'Жим',metric:'weight',split_by_sex:true}]} }))
vi.mock('dexie-react-hooks',()=>({useLiveQuery:fn=>fn()}))
vi.mock('../db/disciplines.js',()=>({getRatingCatalog:()=>mocks.catalog,fetchRatingCatalog:vi.fn().mockResolvedValue()}))
vi.mock('../lib/adminDisciplines.js',()=>({adminSaveDiscipline:(...args)=>mocks.save(...args)}))
import AdminDisciplines from './AdminDisciplines.jsx'
const exercises=[{id:'e1',name:'Жим'},{id:'e2',name:'Планка'},{id:'e3',name:'Скрытое',is_hidden:true}]
beforeEach(()=>mocks.save.mockReset().mockResolvedValue({refreshed:true}))
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
  it('офлайн нельзя менять конфигурацию',()=>{
    render(<AdminDisciplines userId="admin" exercises={exercises} online={false} />)
    expect(screen.getByRole('button',{name:'Убрать из рейтинга: Жим'})).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
