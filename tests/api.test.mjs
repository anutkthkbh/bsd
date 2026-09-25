import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto'
import { build } from 'esbuild'

const compiled = await build({entryPoints:['functions/api/[[path]].ts'],bundle:true,platform:'node',format:'esm',write:false})
const {onRequest} = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const sql = new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
for (const file of readdirSync('migrations').sort()) sql.exec(readFileSync('migrations/'+file,'utf8'))
const DB = {
  prepare(query) {
    const params = []
    const obj = {
      bind(...args) { params.push(...args); return obj },
      async first() { return sql.prepare(query).get(...params) ?? null },
      async all() { return {results:sql.prepare(query).all(...params)} },
      async run() { const result=sql.prepare(query).run(...params);return {meta:{changes:Number(result.changes)}} },
    }
    return obj
  },
  async batch(stmts) {
    sql.exec('BEGIN')
    try {const results=[];for(const stmt of stmts)results.push(await stmt.run());sql.exec('COMMIT');return results}
    catch(e){sql.exec('ROLLBACK');throw e}
  },
}
const call = async(path,{method='GET',body,cookie,origin,db=DB}={}) => {
  const headers = {}
  if(body!==undefined)headers['content-type']='application/json'
  if(cookie)headers.Cookie=cookie
  if(origin)headers.Origin=origin
  const url='https://madarom.example/api'+path
  const response=await onRequest({request:new Request(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env:{DB:db},params:{path:path.slice(1).split('/')}})
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
}
const seedAdmin = () => {
  const salt=randomBytes(32).toString('hex'),hash=pbkdf2Sync('secure-admin-passphrase',salt,210000,32,'sha256').toString('hex')
  sql.prepare("INSERT INTO users(id,email,name,role,password_salt,password_hash) VALUES (?,?,?,'admin',?,?)")
    .run(randomUUID(),'admin@example.com','מנהל',salt,hash)
}

test('Cloudflare API keeps tenant data isolated and checkout disabled',async()=>{
  assert.equal((await call('/catalog',{db:undefined})).status,200)
  assert.equal((await onRequest({request:new Request('https://madarom.example/api/catalog'),env:{},params:{path:['catalog']}})).status,503)
  seedAdmin()
  assert.equal((await call('/login',{method:'POST',body:{email:'admin@example.com',password:'wrong'}})).status,401)
  for(let i=0;i<7;i++) await call('/login',{method:'POST',body:{email:'admin@example.com',password:'wrong'}})
  assert.equal((await call('/login',{method:'POST',body:{email:'admin@example.com',password:'wrong'}})).status,429)
  const admin=await call('/login',{method:'POST',body:{email:'admin@example.com',password:'secure-admin-passphrase'}})
  assert.equal(admin.status,200)
  assert.ok(admin.cookie?.startsWith('madarom_session='))
  const a=await call('/admin/stores',{method:'POST',cookie:admin.cookie,body:{name:'חנות אחת',category:'בית',email:'one@example.com',password:'merchant-passphrase-1'}})
  const b=await call('/admin/stores',{method:'POST',cookie:admin.cookie,body:{name:'חנות שנייה',category:'בית',email:'two@example.com',password:'merchant-passphrase-2'}})
  assert.equal(a.status,201);assert.equal(b.status,201)
  for(const id of [a.data.id,b.data.id]) assert.equal((await call('/admin/stores/'+id+'/status',{method:'PATCH',cookie:admin.cookie,body:{status:'active'}})).status,200)
  const merchant=await call('/login',{method:'POST',body:{email:'one@example.com',password:'merchant-passphrase-1'}})
  assert.equal(merchant.status,200)
  const other=await call('/login',{method:'POST',body:{email:'two@example.com',password:'merchant-passphrase-2'}})
  const product=await call('/merchant/products',{method:'POST',cookie:merchant.cookie,body:{name:'מוצר מקומי',category:'בית',price_agorot:2500,stock:3,variants:[],status:'active'}})
  assert.equal(product.status,200)
  assert.equal((await call('/catalog')).data.products.length,1)
  assert.equal((await call('/merchant/overview',{cookie:other.cookie})).data.products.length,0)
  assert.equal((await call('/merchant/products/'+product.data.id,{method:'PATCH',cookie:other.cookie,body:{name:'שינוי',category:'בית',price_agorot:20,stock:5,variants:[],status:'active'}})).status,404)
  assert.equal((await call('/merchant/products/'+product.data.id,{method:'PATCH',cookie:merchant.cookie,body:{name:'שינוי',category:'בית',price_agorot:20,stock:5,variants:[],status:'active',image_url:'javascript:alert(1)'}})).status,400)
  assert.equal((await call('/checkout',{method:'POST',body:{}})).status,503)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM orders').get().n,0)
  assert.equal((await call('/merchant/profile',{method:'PATCH',cookie:merchant.cookie,origin:'https://attacker.example',body:{}})).status,403)
})

test('ledger rejects edits and deletes',()=>{
  const store=sql.prepare('SELECT id FROM stores LIMIT 1').get()
  assert.ok(store)
  const id=randomUUID()
  sql.prepare('INSERT INTO ledger_entries(id,store_id,kind,amount_agorot,idempotency_key) VALUES (?,?,?,?,?)').run(id,store.id,'sale',100,'payment-1')
  assert.throws(()=>sql.prepare('UPDATE ledger_entries SET amount_agorot=0 WHERE id=?').run(id))
  assert.throws(()=>sql.prepare('DELETE FROM ledger_entries WHERE id=?').run(id))
})
