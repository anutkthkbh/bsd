import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID, pbkdf2Sync } from 'node:crypto'
import { build } from 'esbuild'

const compiled = await build({entryPoints:['functions/api/[[path]].ts'],bundle:true,platform:'node',format:'esm',write:false})
const {onRequest} = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))

function database() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const file of readdirSync('migrations').sort()) sql.exec(readFileSync('migrations/'+file,'utf8'))
  const DB={
    prepare(query) {
      const params=[]
      const stmt={
        bind(...args){params.push(...args);return stmt},
        async first(){return sql.prepare(query).get(...params)??null},
        async all(){return {results:sql.prepare(query).all(...params)}},
        async run(){const result=sql.prepare(query).run(...params);return {meta:{changes:Number(result.changes)}}},
      }
      return stmt
    },
    async batch(stmts){
      sql.exec('BEGIN')
      try{const results=[];for(const stmt of stmts)results.push(await stmt.run());sql.exec('COMMIT');return results}
      catch(error){sql.exec('ROLLBACK');throw error}
    },
  }
  return {sql,DB}
}

async function call(DB,path,{method='GET',body,cookie}={}) {
  const headers={}
  if(body!==undefined)headers['content-type']='application/json'
  if(cookie)headers.Cookie=cookie
  const response=await onRequest({
    request:new Request('https://madarom.example/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),
    env:{DB},
    params:{path:path.slice(1).split('/')},
  })
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
}

test('customer account keeps profile and purchase-request history isolated',async()=>{
  const {sql,DB}=database()
  assert.equal((await call(DB,'/register',{method:'POST',body:{name:'לקוח בדיקה',email:'buyer@example.com',password:'very-secure-customer-password'}})).status,403)
  const legacyId=randomUUID(),salt='local-test-salt'
  sql.prepare("INSERT INTO users(id,email,name,role,password_salt,password_hash) VALUES (?,?,?,'customer',?,?)").run(legacyId,'buyer@example.com','לקוח בדיקה',salt,pbkdf2Sync('very-secure-customer-password',salt,210000,32,'sha256').toString('hex'))
  sql.prepare('INSERT INTO customer_profiles(user_id,phone) VALUES (?,?)').run(legacyId,'050-1234567')
  sql.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject) VALUES (?,?,'password',?)").run(randomUUID(),legacyId,'buyer@example.com')
  const registration=await call(DB,'/login',{method:'POST',body:{email:'buyer@example.com',password:'very-secure-customer-password'}})
  assert.equal(registration.status,200)
  assert.equal(registration.data.user.role,'customer')
  assert.ok(registration.cookie?.startsWith('madarom_session='))
  assert.equal(sql.prepare("SELECT role FROM users WHERE email='buyer@example.com'").get().role,'customer')
  assert.equal(sql.prepare("SELECT provider FROM auth_identities WHERE user_id=(SELECT id FROM users WHERE email='buyer@example.com')").get().provider,'password')

  const initial=await call(DB,'/account',{cookie:registration.cookie})
  assert.equal(initial.status,200)
  assert.equal(initial.data.user.email,'buyer@example.com')
  assert.equal(initial.data.profile.phone,'050-1234567')
  assert.equal(initial.data.profile.email_verified,0)
  assert.deepEqual(initial.data.requests,[])

  const changed=await call(DB,'/account',{method:'PATCH',cookie:registration.cookie,body:{name:'לקוח מעודכן',phone:'052-7654321'}})
  assert.equal(changed.status,200)
  assert.equal(changed.data.user.name,'לקוח מעודכן')
  assert.equal(changed.data.profile.phone,'+972527654321')

  const storeId=randomUUID(),productId=randomUUID()
  sql.prepare("INSERT INTO stores(id,slug,name,category,status) VALUES (?,?,?,?, 'active')").run(storeId,'history-store','חנות היסטוריה','בית')
  sql.prepare(`INSERT INTO products(id,store_id,slug,name,category,price_agorot,stock,status,variants_json)
    VALUES (?,?,?,?,?,?,?,'active','[]')`).run(productId,storeId,'history-product','מוצר היסטוריה','בית',4200,5)
  const items=[{product_id:productId,quantity:2}]
  const quote=await call(DB,'/checkout/quote',{method:'POST',body:{items}})
  assert.equal(quote.status,200)
  const sent=await call(DB,'/purchase-requests',{method:'POST',cookie:registration.cookie,body:{
    items,
    idempotency_key:randomUUID(),
    customer_name:'שם שלא אמור לגבור על החשבון',
    customer_email:'other@example.com',
    customer_phone:'054-1112233',
    expected_total_agorot:quote.data.total_agorot,
  }})
  assert.equal(sent.status,201)

  const account=await call(DB,'/account',{cookie:registration.cookie})
  assert.equal(account.status,200)
  assert.equal(account.data.profile.phone,'+972541112233')
  assert.equal(account.data.requests.length,1)
  assert.equal(account.data.requests[0].total_agorot,8400)
  assert.equal(account.data.requests[0].stores[0].store_name,'חנות היסטוריה')
  assert.equal(account.data.requests[0].stores[0].items[0].product_name,'מוצר היסטוריה')
  const saved=sql.prepare('SELECT user_id,customer_name,customer_email,customer_phone FROM purchase_requests WHERE id=?').get(sent.data.id)
  assert.equal(saved.user_id,registration.data.user.id)
  assert.equal(saved.customer_name,'לקוח מעודכן')
  assert.equal(saved.customer_email,'buyer@example.com')
  assert.equal(saved.customer_phone,'+972541112233')

  assert.equal((await call(DB,'/merchant/overview',{cookie:registration.cookie})).status,403)
  assert.equal((await call(DB,'/admin/overview',{cookie:registration.cookie})).status,403)

  const duplicate=await call(DB,'/register',{method:'POST',body:{
    name:'לקוח אחר',email:'buyer@example.com',password:'another-secure-customer-password',
  }})
  assert.equal(duplicate.status,403)

  const login=await call(DB,'/login',{method:'POST',body:{email:'buyer@example.com',password:'very-secure-customer-password'}})
  assert.equal(login.status,200)
  assert.equal(login.data.user.role,'customer')
})
