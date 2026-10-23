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
vi.mock('../db/repo.js',()=>({ getCachedUser:()=>({sex:data.sex}), getUsers:()=>[] }))
import DisciplineLeaderboard from './DisciplineLeaderboard.jsx'
import { fetchRatingBoard } from '../db/disciplines.js'
const weight={id:'w',name:'Жим',metric:'weight',split_by_sex:true}
const time={id:'t',name:'Планка',metric:'time',split_by_sex:false}
beforeEach(()=>{
  // v9.1.0: «Общего» нет — доски только кругов; по умолчанию человек в одном активном круге.
  data.catalog={items:[weight,time]};data.sex='f';data.private=false
  data.circles=[{circle_id:'c1',name:'Основатели',my_status:'active'}];data.circleCatalog={items:[weight,time]}
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
    await user.click(screen.getByRole('button',{name:/Борис.*Открыть профиль/}))
    expect(open).toHaveBeenCalledWith('man','lb-man')
    await user.click(screen.getByRole('button',{name:'Планка'}))
    expect(screen.getByText('1:30')).toBeInTheDocument()
    expect(screen.queryByText(/кг/)).toBeNull()
    expect(screen.queryByRole('group',{name:'Участники рейтинга'})).toBeNull()
  })
  it('снимка кругов нет — сначала «Загружаю», «Создай круг» только после ответа сервера (UI-ревью 23.10)',async()=>{
    data.circles=null
    render(<DisciplineLeaderboard user={{id:'woman'}} onOpenCircle={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Загружаю рейтинг')
    expect(await screen.findByText(/Создай круг/)).toBeInTheDocument()
  })
  it('без круга — рейтинга нет, подсказка «Мой круг»',async()=>{
    data.circles=[]
    const user=userEvent.setup();const openCircle=vi.fn()
    render(<DisciplineLeaderboard user={{id:'woman'}} onOpenCircle={openCircle} />)
    expect(screen.queryByText('80 кг')).toBeNull()
    expect(screen.getByText(/Создай круг/)).toBeInTheDocument()
    await user.click(screen.getByRole('button',{name:'Мой круг'}))
    expect(openCircle).toHaveBeenCalled()
  })
  it('доски — только активные круги, «Общего» нет (v9.1.0); pending-круга нет',async()=>{
    data.circles=[{circle_id:'c1',name:'Основатели',my_status:'active'},{circle_id:'c3',name:'Зал',my_status:'active'},
      {circle_id:'c2',name:'Ждет',my_status:'pending'}]
    data.circleCatalog={items:[{id:'cw',name:'Жим круга',metric:'weight',split_by_sex:false}]}
    data.rows.push({discipline:'cw',user_id:'woman',user_name:'Аня',board:'all',value:70,weight:70,reps:1,orm:70})
    const user=userEvent.setup()
    const {unmount}=render(<DisciplineLeaderboard user={{id:'woman'}} />)
    expect(screen.queryByRole('button',{name:'Общий'})).toBeNull()
    expect(screen.queryByRole('button',{name:'Ждет'})).toBeNull()
    await user.click(screen.getByRole('button',{name:'Зал'}))
    expect(screen.getByRole('button',{name:'Жим круга'})).toBeInTheDocument()
    expect(screen.getByText('70 кг')).toBeInTheDocument()
    expect(fetchRatingBoard).toHaveBeenCalledWith('woman',expect.objectContaining({id:'cw'}),{circle:'c3'})
    unmount()
    data.circles=[{circle_id:'c1',name:'Основатели',my_status:'active'}]
    render(<DisciplineLeaderboard user={{id:'woman'}} />)
    expect(screen.queryByRole('group',{name:'Чей рейтинг'})).toBeNull()
    expect(screen.getByRole('button',{name:'Жим круга'})).toBeInTheDocument()
  })
  it('пустой каталог круга не возвращает старый жим',()=>{
    data.circleCatalog={items:[]}
    render(<DisciplineLeaderboard user={{id:'woman'}} />)
    expect(screen.getByText(/В круге пока нет дисциплин/)).toBeInTheDocument()
    // Пустой ряд дисциплин не рисуем — он добавлял отступ над карточкой (fb_c0b7096d).
    expect(screen.queryByRole('group',{name:'Дисциплина'})).toBeNull()
  })
})
