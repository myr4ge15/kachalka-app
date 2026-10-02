import { test, expect } from '@playwright/test'

test('дисциплины: группы, время и офлайн после перезапуска', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator,'onLine',{get:()=>false}))
  await context.route(/supabase\.co/,route=>route.abort())
  await page.goto('/kachalka-app/')
  const user=await page.evaluate(async()=> (await import('/kachalka-app/src/test/e2eSeed.js')).seedE2E())
  await page.reload()
  await page.getByRole('button',{name:user.name}).click()
  for(const digit of user.pin) await page.locator('.keypad .key',{hasText:new RegExp(`^${digit}$`)}).click()
  await expect(page.locator('.tabbar')).toBeVisible()
  await page.evaluate(async userId=>{
    const {setMeta,loginDb}=await import('/kachalka-app/src/db/local.js')
    const {disciplineSignature}=await import('/kachalka-app/src/lib/disciplines.js')
    await loginDb.users.update(userId,{sex:'f'})
    const catalog=[
      {id:'bench',exercise_id:'e2e-ex-bench',name:'Жим лёжа',metric:'weight',split_by_sex:true,updated_at:'2026-10-02'},
      {id:'plank',exercise_id:'plank',name:'Планка',metric:'time',split_by_sex:false,updated_at:'2026-10-02'},
      {id:'pullups',exercise_id:'pullups',name:'Подтягивания',metric:'reps',split_by_sex:false,updated_at:'2026-10-02'},
    ]
    await setMeta('rating_catalog',{items:catalog,fetchedAt:'2026-10-02T12:00:00Z'})
    const rows=[
      [{user_id:userId,user_name:'Аня',board:'f',weight:80,reps:5,value:80,orm:93.5},{user_id:'friend',user_name:'Борис',board:'m',weight:100,reps:3,value:100,orm:110}],
      [{user_id:userId,user_name:'Аня',board:'all',weight:0,reps:90,value:90},{user_id:'friend',user_name:'Борис',board:'all',weight:0,reps:120,value:120}],
      [{user_id:userId,user_name:'Аня',board:'all',weight:0,reps:12,value:12}],
    ]
    for(let i=0;i<catalog.length;i++) await setMeta(`rating_board_${catalog[i].id}`,{
      signature:disciplineSignature(catalog[i]),fetchedAt:'2026-10-02T12:00:00Z',
      rows:rows[i].map(r=>({...r,metric:catalog[i].metric,performed_at:'2026-10-01T12:00:00Z'})),
    })
  },user.id)
  await page.getByRole('button',{name:'Лента',exact:true}).click()
  await expect(page.getByRole('button',{name:'Женщины',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(page.getByText('80 кг',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Мужчины',exact:true}).click()
  await expect(page.getByText('100 кг',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Планка',exact:true}).click()
  await expect(page.getByText('1:30',{exact:true})).toBeVisible()
  await expect(page.getByText('2:00',{exact:true})).toBeVisible()
  await expect(page.getByText('Борис впереди на 30 сек.',{exact:true})).toBeVisible()
  await expect(page.locator('.lb-row').first()).toContainText('2:00')
  await page.screenshot({path:'test-results/disciplines-time.png'})
  await page.getByRole('button',{name:'Подтягивания',exact:true}).click()
  await expect(page.getByText('12 повт.',{exact:true})).toBeVisible()
  await page.reload()
  await page.getByRole('button',{name:'Планка',exact:true}).click()
  await expect(page.getByText('1:30',{exact:true})).toBeVisible()
  await expect(page.getByText(/Без сети · сохранено/)).toBeVisible()
  await page.setViewportSize({width:320,height:740})
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})
