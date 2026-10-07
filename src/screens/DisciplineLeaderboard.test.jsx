// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const data = vi.hoisted(() => ({ catalog:null, circleCatalog:null, rows:[], sex:'f', private:false, circles:null }))
vi.mock('dexie-react-hooks',()=>({ useLiveQuery:fn=>fn() }))
vi.mock('../db/disciplines.js',()=>({
  getRatingCatalog:(c)=>c ? data.circleCatalog : data.catalog, getRatingBoard:d=>({ rows:data.rows.filter(r=>r.discipline===d.id),fetchedAt:'2026-10-02T12:00:00Z' }),
  fetchRatingCatalog:vi.fn().mockResolvedValue(),fetchRatingBoard:vi.fn().mockResolvedValue(),
}))
vi.mock('../db/circles.js',()=>({ getMyCircles:()=>data.circles, refreshMyCircles:vi.fn() }))
vi.mock('../db/repo.js',()=>({ getCachedUser:()=>({sex:data.sex}), getUsers:()=>[],getPrivacyFlag:()=>data.private }))
vi.mock('./LegacyLeaderboard.jsx',()=>({default:()=> <p>Старый рейтинг</p>}))
import DisciplineLeaderboard from './DisciplineLeaderboard.jsx'
import { fetchRatingBoard } from '../db/disciplines.js'
const weight={id:'w',name:'Жим',metric:'weight',split_by_sex:true}
const time={id:'t',name:'Планка',metric:'time',split_by_sex:false}
beforeEach(()=>{
  data.catalog={items:[weight,time]};data.sex='f';data.private=false;data.circles=null;data.circleCatalog=null
  data.rows=[
    {discipline:'w',user_id:'woman',user_name:'Аня',board:'f',value:80,weight:80,reps:5,orm:90},
    {discipline:'w',user_id:'man',user_name:'Борис',board:'m',value:100,weight:100,reps:3,orm:110},
    {discipline:'t',user_id:'woman',user_name:'Аня',board:'all',value:90,weight:0,reps:90,performed_at:'2026-10-01'},
  ]
})
describe('дисциплины в Ленте',()=>{
  it('выбирает женскую группу и переключает группы/метрики без килограммов у времени',async()=>{
    const user=userEvent.setup();const open=vi.fn()
    render(<DisciplineLeaderboard user={{id:'woman'}} onOpenMember={open} />)
    expect(screen.getByText('80 кг')).toBeInTheDocument()
    expect(screen.queryByText('100 кг')).toBeNull()
    await user.click(screen.getByRole('button',{name:'Мужчины'}))
    expect(screen.getByText('100 кг')).toBeInTheDocument()
    await user.click(screen.getByRole('button',{name:'Открыть профиль: Борис'}))
    expect(open).toHaveBeenCalledWith('man','lb-man')
    await user.click(screen.getByRole('button',{name:'Планка'}))
    expect(screen.getByText('1:30')).toBeInTheDocument()
    expect(screen.queryByText(/кг/)).toBeNull()
    expect(screen.queryByRole('group',{name:'Участники рейтинга'})).toBeNull()
  })
  it('приватному без круга — общего рейтинга нет, подсказка «Мой круг»',async()=>{
    data.private=true
    const user=userEvent.setup();const openCircle=vi.fn()
    render(<DisciplineLeaderboard user={{id:'woman'}} onOpenCircle={openCircle} />)
    expect(screen.queryByText('80 кг')).toBeNull()
    expect(screen.getByText(/Создай круг/)).toBeInTheDocument()
    await user.click(screen.getByRole('button',{name:'Мой круг'}))
    expect(openCircle).toHaveBeenCalled()
  })
  it('доски: «Общий» и круг; приватному — только круг; pending-круга нет',async()=>{
    data.circles=[{circle_id:'c1',name:'Зал',my_status:'active'},{circle_id:'c2',name:'Ждет',my_status:'pending'}]
    data.circleCatalog={items:[{id:'cw',name:'Жим круга',metric:'weight',split_by_sex:false}]}
    data.rows.push({discipline:'cw',user_id:'woman',user_name:'Аня',board:'all',value:70,weight:70,reps:1,orm:70})
    const user=userEvent.setup()
    const {unmount}=render(<DisciplineLeaderboard user={{id:'woman'}} />)
    expect(screen.queryByRole('button',{name:'Ждет'})).toBeNull()
    await user.click(screen.getByRole('button',{name:'Зал'}))
    expect(screen.getByRole('button',{name:'Жим круга'})).toBeInTheDocument()
    expect(screen.getByText('70 кг')).toBeInTheDocument()
    expect(fetchRatingBoard).toHaveBeenCalledWith('woman',expect.objectContaining({id:'cw'}),{circle:'c1'})
    unmount()
    data.private=true
    render(<DisciplineLeaderboard user={{id:'woman'}} />)
    expect(screen.queryByRole('group',{name:'Чей рейтинг'})).toBeNull()
    expect(screen.getByRole('button',{name:'Жим круга'})).toBeInTheDocument()
  })
  it('пустой серверный каталог не возвращает старый жим',()=>{
    data.catalog={items:[]}
    render(<DisciplineLeaderboard user={{id:'woman'}} />)
    expect(screen.getByText(/Пока нет дисциплин/)).toBeInTheDocument()
    expect(screen.queryByText('Старый рейтинг')).toBeNull()
  })
  it('до установки серверной части остается старый рейтинг',()=>{
    data.catalog=null
    render(<DisciplineLeaderboard user={{id:'woman'}} />)
    expect(screen.getByText('Старый рейтинг')).toBeInTheDocument()
  })
})
