import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
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

test('customer can register, receive a session and access only customer account',async()=>{
  const {sql,DB}=database()
  const registration=await call(DB,'/register',{method:'POST',body:{
    name:'לקוח בדיקה',email:'buyer@example.com',phone:'050-1234567',password:'very-secure-customer-password',
  }})
  assert.equal(registration.status,201)
  assert.equal(registration.data.user.role,'customer')
  assert.ok(registration.cookie?.startsWith('madarom_session='))
  assert.equal(sql.prepare("SELECT role FROM users WHERE email='buyer@example.com'").get().role,'customer')
  assert.equal(sql.prepare("SELECT provider FROM auth_identities WHERE user_id=(SELECT id FROM users WHERE email='buyer@example.com')").get().provider,'password')

  const account=await call(DB,'/account',{cookie:registration.cookie})
  assert.equal(account.status,200)
  assert.equal(account.data.user.email,'buyer@example.com')
  assert.equal(account.data.profile.phone,'050-1234567')
  assert.equal(account.data.profile.email_verified,0)

  assert.equal((await call(DB,'/merchant/overview',{cookie:registration.cookie})).status,403)
  assert.equal((await call(DB,'/admin/overview',{cookie:registration.cookie})).status,403)

  const duplicate=await call(DB,'/register',{method:'POST',body:{
    name:'לקוח אחר',email:'buyer@example.com',password:'another-secure-customer-password',
  }})
  assert.equal(duplicate.status,409)

  const login=await call(DB,'/login',{method:'POST',body:{email:'buyer@example.com',password:'very-secure-customer-password'}})
  assert.equal(login.status,200)
  assert.equal(login.data.user.role,'customer')
})
