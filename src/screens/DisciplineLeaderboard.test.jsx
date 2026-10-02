// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const data = vi.hoisted(() => ({ catalog:null, rows:[], sex:'f', private:false }))
vi.mock('dexie-react-hooks',()=>({ useLiveQuery:fn=>fn() }))
vi.mock('../db/disciplines.js',()=>({
  getRatingCatalog:()=>data.catalog, getRatingBoard:d=>({ rows:data.rows.filter(r=>r.discipline===d.id),fetchedAt:'2026-10-02T12:00:00Z' }),
  fetchRatingCatalog:vi.fn().mockResolvedValue(),fetchRatingBoard:vi.fn().mockResolvedValue(),
}))
vi.mock('../db/repo.js',()=>({ getCachedUser:()=>({sex:data.sex}), getUsers:()=>[],getPrivacyFlag:()=>data.private }))
vi.mock('./LegacyLeaderboard.jsx',()=>({default:()=> <p>Старый рейтинг</p>}))
import DisciplineLeaderboard from './DisciplineLeaderboard.jsx'
const weight={id:'w',name:'Жим',metric:'weight',split_by_sex:true}
const time={id:'t',name:'Планка',metric:'time',split_by_sex:false}
beforeEach(()=>{
  data.catalog={items:[weight,time]};data.sex='f';data.private=false
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
  it('приватному участнику рейтинг скрыт',()=>{
    data.private=true
    const {container}=render(<DisciplineLeaderboard user={{id:'woman'}} />)
    expect(container).toBeEmptyDOMElement()
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
