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

test('purchase requests reprice server-side, split by store, isolate contact details and never charge',async()=>{
  const stores=sql.prepare('SELECT id FROM stores ORDER BY name').all()
  assert.equal(stores.length,2)
  const otherStore=stores.find(s=>s.id!==sql.prepare('SELECT store_id FROM products LIMIT 1').get().store_id)
  const productOne=sql.prepare('SELECT id FROM products LIMIT 1').get().id
  const productTwo=randomUUID()
  sql.prepare(`INSERT INTO products(id,store_id,slug,name,category,price_agorot,stock,status)
    VALUES (?,?,?,?,?,?,?,'active')`).run(productTwo,otherStore.id,'other-item','מוצר שני','בית',7300,4)
  const items=[{product_id:productOne,quantity:2},{product_id:productTwo,quantity:1}]
  const quote=await call('/checkout/quote',{method:'POST',body:{items}})
  assert.equal(quote.status,200)
  assert.equal(quote.data.groups.length,2)
  assert.equal(quote.data.total_agorot,sql.prepare('SELECT price_agorot FROM products WHERE id=?').get(productOne).price_agorot*2+7300)
  assert.equal(quote.data.payment_available,false)
  assert.equal((await call('/checkout/quote',{method:'POST',body:{items:[{product_id:productOne,quantity:4}]}})).status,409)
  assert.equal((await call('/checkout/quote',{method:'POST',body:{items:[{product_id:productOne,quantity:1,variant:'forged'}]}})).status,409)
  const key=randomUUID(),customer={customer_name:'לקוח בדיקה',customer_email:'buyer@example.com',customer_phone:'050-1234567'}
  assert.equal((await call('/purchase-requests',{method:'POST',body:{items,idempotency_key:randomUUID(),...customer,expected_total_agorot:1}})).status,409)
  const submitted={items,idempotency_key:key,...customer,expected_total_agorot:quote.data.total_agorot}
  const sent=await call('/purchase-requests',{method:'POST',body:submitted})
  assert.equal(sent.status,201)
  assert.equal((await call('/purchase-requests',{method:'POST',body:submitted})).data.id,sent.data.id)
  assert.equal((await call('/purchase-requests',{method:'POST',body:{...submitted,items:[items[0]]}})).status,409)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM purchase_requests').get().n,1)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM store_requests').get().n,2)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM orders').get().n,0)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM payment_attempts').get().n,0)
  const merchantOne=await call('/login',{method:'POST',body:{email:'one@example.com',password:'merchant-passphrase-1'}})
  const merchantTwo=await call('/login',{method:'POST',body:{email:'two@example.com',password:'merchant-passphrase-2'}})
  const one=(await call('/merchant/overview',{cookie:merchantOne.cookie})).data.requests
  const two=(await call('/merchant/overview',{cookie:merchantTwo.cookie})).data.requests
  assert.equal(one.length,1);assert.equal(two.length,1)
  assert.equal(one[0].items.length,1);assert.equal(two[0].items.length,1)
  assert.equal(one[0].customer_email,customer.customer_email)
  assert.equal((await call(`/merchant/requests/${two[0].id}`,{method:'PATCH',cookie:merchantOne.cookie,body:{status:'contacted'}})).status,404)
  assert.equal((await call(`/merchant/requests/${one[0].id}`,{method:'PATCH',cookie:merchantOne.cookie,body:{status:'contacted'}})).status,200)
})

test('merchant image upload validates bytes, tenant ownership and public media read',async()=>{
  const merchant=await call('/login',{method:'POST',body:{email:'one@example.com',password:'merchant-passphrase-1'}})
  const objects=new Map()
  const MEDIA={
    async put(key,bytes){objects.set(key,bytes)},
    async get(key){const bytes=objects.get(key);return bytes?{body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close()}})}:null},
  }
  const invoke=(path,request)=>onRequest({request,env:{DB,MEDIA},params:{path:path.slice(1).split('/')}})
  const image=new Uint8Array([0xff,0xd8,0xff,0xe0,0x00,0x01])
  const uploadPath='/merchant/media'
  const upload=await invoke(uploadPath,new Request('https://madarom.example/api'+uploadPath,{
    method:'POST',headers:{Cookie:merchant.cookie,'content-type':'image/jpeg'},body:image,
  }))
  assert.equal(upload.status,201)
  const {url}=await upload.json()
  assert.match(url,/^\/api\/media\/[\w-]+\/[0-9a-f-]+\.jpg$/)
  const mediaPath=url.replace('/api','')
  const retrieved=await invoke(mediaPath,new Request('https://madarom.example'+url))
  assert.equal(retrieved.headers.get('content-type'),'image/jpeg')
  assert.deepEqual(new Uint8Array(await retrieved.arrayBuffer()),image)
  const product=sql.prepare('SELECT id,store_id FROM products LIMIT 1').get()
  const own=await call('/merchant/products/'+product.id,{method:'PATCH',cookie:merchant.cookie,
    body:{name:'ספל',category:'בית',price_agorot:3000,stock:4,variants:[],status:'active',image_url:url}})
  assert.equal(own.status,200)
  const other=await call('/login',{method:'POST',body:{email:'two@example.com',password:'merchant-passphrase-2'}})
  const cross=await call('/merchant/products',{method:'POST',cookie:other.cookie,
    body:{name:'ספל',category:'בית',price_agorot:3000,stock:4,variants:[],status:'active',image_url:url}})
  assert.equal(cross.status,400)
  const invalid=await invoke(uploadPath,new Request('https://madarom.example/api'+uploadPath,{
    method:'POST',headers:{Cookie:merchant.cookie,'content-type':'image/jpeg'},body:new Uint8Array([60,115,118,103,62]),
  }))
  assert.equal(invalid.status,400)
})
