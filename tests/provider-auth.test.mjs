import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID, pbkdf2Sync } from 'node:crypto'
import { build } from 'esbuild'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

const compiled = await build({entryPoints:['functions/api/[[path]].ts'],bundle:true,platform:'node',format:'esm',write:false,
  plugins:[{name:'test-smtp',setup(builder){
    builder.onResolve({filter:/^nodemailer$/},()=>({path:'test-smtp',namespace:'test'}))
    builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export default {createTransport(options){
      return {sendMail(message){return globalThis.__testSmtp(options,message)},close(){}}
    }}`,loader:'js'}))
  }}]})
const {onRequest} = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const signing=await generateKeyPair('RS256'),publicJwk={...await exportJWK(signing.publicKey),kid:'test-rsa',alg:'RS256',use:'sig'}

function database(skipMigration) {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const file of readdirSync('migrations').sort()) if (file!==skipMigration) sql.exec(readFileSync('migrations/'+file,'utf8'))
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

async function call(DB,path,{method='GET',body,cookie,env={}}={}) {
  const headers={}
  if(body!==undefined)headers['content-type']='application/json'
  if(cookie)headers.Cookie=cookie
  const response=await onRequest({
    request:new Request('https://madarom.example/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),
    env:{DB,...env},
    params:{path:path.split('?')[0].slice(1).split('/')},
  })
  return {status:response.status,data:await response.json().catch(()=>null),headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]}
}

const providers={RESEND_API_KEY:'test-only',EMAIL_FROM:'Madarom <test@example.com>',TWILIO_ACCOUNT_SID:'test-only',TWILIO_AUTH_TOKEN:'test-only',TWILIO_FROM:'+15005550006',GOOGLE_CLIENT_ID:'test-only',GOOGLE_CLIENT_SECRET:'test-only'}
function delivery(t,{fail=false}={}) {
  const messages=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url)==='https://api.resend.com/emails') {
      const data=JSON.parse(options.body);messages.push({to:data.to[0],code:data.text.match(/\b\d{6}\b/)[0]})
    } else if(String(url).startsWith('https://api.twilio.com/')) {
      const data=new URLSearchParams(options.body);messages.push({to:data.get('To'),code:data.get('Body').match(/\b\d{6}\b/)[0]})
    } else throw new Error('unexpected external request')
    return new Response('{"id":"test-delivery"}',{status:fail?503:200})
  })
  return messages
}
async function emailAccount(DB,messages,email='customer@example.com') {
  const request=await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'email',target:email,name:'לקוח בדיקה',role:'admin'}})
  assert.equal(request.status,201)
  assert.deepEqual(Object.keys(request.data).sort(),['challenge_id','ok'])
  const verified=await call(DB,'/auth/verify-code',{method:'POST',body:{challenge_id:request.data.challenge_id,code:messages.at(-1).code}})
  assert.equal(verified.status,200)
  return {...verified,challenge_id:request.data.challenge_id,code:messages.at(-1).code}
}

test('unconfigured providers fail honestly and failed delivery leaves no usable challenge',async t=>{
  const {sql,DB}=database()
  const cap=await call(DB,'/auth/capabilities');assert.deepEqual(cap.data,{email:false,sms:false,google:false})
  assert.equal((await call(DB,'/auth/request-code',{method:'POST',body:{channel:'email',target:'buyer@example.com',name:'לקוח'}})).status,503)
  assert.equal((await call(DB,'/auth/google/start')).status,503)
  delivery(t,{fail:true})
  assert.equal((await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'email',target:'buyer@example.com',name:'לקוח'}})).status,503)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM verification_challenges').get().n,0)
})

test('email OTP registers verified customers, prevents role escalation/replay and logs out',async t=>{
  const {sql,DB}=database(),messages=delivery(t)
  const account=await emailAccount(DB,messages)
  assert.equal(account.data.user.role,'customer');assert.equal(account.data.redirect,'/account')
  assert.match(account.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/)
  assert.notEqual(sql.prepare('SELECT code_hash FROM verification_challenges WHERE id=?').get(account.challenge_id).code_hash,account.code)
  assert.equal((await call(DB,'/account',{cookie:account.cookie})).data.profile.email_verified,1)
  assert.equal((await call(DB,'/account',{cookie:account.cookie})).data.google_linked,false)
  assert.equal((await call(DB,'/admin/overview',{cookie:account.cookie})).status,403)
  assert.equal((await call(DB,'/merchant/overview',{cookie:account.cookie})).status,403)
  assert.equal((await call(DB,'/auth/verify-code',{method:'POST',body:{challenge_id:account.challenge_id,code:account.code}})).status,401)
  await call(DB,'/logout',{method:'POST',cookie:account.cookie})
  assert.equal((await call(DB,'/session',{cookie:account.cookie})).data.user,null)
})

test('codes expire, lock after five attempts, and sends are rate limited',async t=>{
  const {sql,DB}=database(),messages=delivery(t)
  const request=await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'email',target:'lock@example.com',name:'לקוח'}})
  const code=messages.at(-1).code,wrong=code==='000000'?'111111':'000000',payload={challenge_id:request.data.challenge_id}
  assert.equal((await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'email',target:'lock@example.com',name:'לקוח'}})).status,429)
  for(let i=0;i<5;i++)assert.equal((await call(DB,'/auth/verify-code',{method:'POST',body:{...payload,code:wrong}})).status,401)
  assert.equal((await call(DB,'/auth/verify-code',{method:'POST',body:{...payload,code}})).status,401)
  const expired=await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'email',target:'expiry@example.com',name:'לקוח'}})
  sql.prepare("UPDATE verification_challenges SET expires_at=datetime('now','-1 second') WHERE id=?").run(expired.data.challenge_id)
  assert.equal((await call(DB,'/auth/verify-code',{method:'POST',body:{challenge_id:expired.data.challenge_id,code:messages.at(-1).code}})).status,401)
  for(let i=0;i<4;i++) {
    sql.prepare("UPDATE verification_challenges SET created_at=datetime('now','-2 minutes') WHERE target='lock@example.com'").run()
    assert.equal((await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'email',target:'lock@example.com',name:'לקוח'}})).status,201)
  }
  sql.prepare("UPDATE verification_challenges SET created_at=datetime('now','-2 minutes')").run()
  assert.equal((await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'email',target:'lock@example.com',name:'לקוח'}})).status,429)
})

test('verified email sends existing staff to their assigned management area',async t=>{
  const {sql,DB}=database(),messages=delivery(t),store=randomUUID()
  sql.prepare("INSERT INTO stores(id,slug,name,category) VALUES (?,?,?,?)").run(store,'auth-store','חנות בדיקה','בית')
  for(const [role,path] of [['admin','/admin'],['merchant','/merchant']]) {
    sql.prepare('INSERT INTO users(id,email,name,role,store_id) VALUES (?,?,?,?,?)').run(randomUUID(),`${role}@example.com`,'משתמש בדיקה',role,role==='merchant'?store:null)
    const user=await emailAccount(DB,messages,`${role}@example.com`)
    assert.equal(user.data.user.role,role);assert.equal(user.data.redirect,path)
  }
})

test('SMS proof binds to the current account, cannot trust an entered phone, and revokes on change',async t=>{
  const {sql,DB}=database(),messages=delivery(t),account=await emailAccount(DB,messages)
  await call(DB,'/account',{method:'PATCH',cookie:account.cookie,body:{name:'לקוח בדיקה',phone:'0501234567'}})
  const before=messages.length
  assert.equal((await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'sms',target:'0501234567'}})).status,409)
  assert.equal(messages.length,before)
  const request=await call(DB,'/auth/request-code',{method:'POST',env:providers,cookie:account.cookie,body:{channel:'sms',target:'0501234567',purpose:'verify'}})
  assert.equal(request.status,201);assert.equal(messages.at(-1).to,'+972501234567')
  const payload={challenge_id:request.data.challenge_id,code:messages.at(-1).code}
  assert.equal((await call(DB,'/auth/verify-code',{method:'POST',body:payload})).status,401)
  assert.equal((await call(DB,'/auth/verify-code',{method:'POST',cookie:account.cookie,body:payload})).status,200)
  assert.equal((await call(DB,'/account',{cookie:account.cookie})).data.profile.phone_verified,1)
  await call(DB,'/account',{method:'PATCH',cookie:account.cookie,body:{name:'לקוח בדיקה',phone:'050-1234567'}})
  assert.equal((await call(DB,'/account',{cookie:account.cookie})).data.profile.phone_verified,1)
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE provider='sms_code'").get().n,1)
  const identity=sql.prepare("SELECT * FROM auth_identities WHERE provider='sms_code'").get()
  sql.prepare('DELETE FROM auth_identities WHERE id=?').run(identity.id)
  assert.equal(sql.prepare('SELECT phone_verified FROM customer_profiles WHERE user_id=?').get(account.data.user.id).phone_verified,1)
  assert.equal((await call(DB,'/auth/status',{cookie:account.cookie})).data.phone_verified,false)
  assert.equal((await call(DB,'/account',{cookie:account.cookie})).data.profile.phone_verified,0)
  sql.prepare('INSERT INTO auth_identities(id,user_id,provider,provider_subject) VALUES (?,?,?,?)')
    .run(identity.id,identity.user_id,identity.provider,identity.provider_subject)
  sql.prepare("UPDATE verification_challenges SET created_at=datetime('now','-2 minutes')").run()
  const login=await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'sms',target:'0501234567'}})
  const session=await call(DB,'/auth/verify-code',{method:'POST',body:{challenge_id:login.data.challenge_id,code:messages.at(-1).code}})
  assert.equal(session.data.user.id,account.data.user.id)
  await call(DB,'/account',{method:'PATCH',cookie:account.cookie,body:{name:'לקוח בדיקה',phone:'0521234567'}})
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE provider='sms_code'").get().n,0)
  assert.equal((await call(DB,'/account',{cookie:account.cookie})).data.profile.phone_verified,0)
})

test('verified email invalidates credentials from an unverified password registration',async t=>{
  const {sql,DB}=database(),messages=delivery(t)
  const id=randomUUID(),salt='local-test-salt'
  sql.prepare("INSERT INTO users(id,email,name,role,password_salt,password_hash) VALUES (?,?,?,'customer',?,?)").run(id,'customer@example.com','שם ישן',salt,pbkdf2Sync('very-secure-old-password',salt,210000,32,'sha256').toString('hex'))
  sql.prepare('INSERT INTO customer_profiles(user_id) VALUES (?)').run(id)
  const old=await call(DB,'/login',{method:'POST',body:{email:'customer@example.com',password:'very-secure-old-password'}})
  const account=await emailAccount(DB,messages)
  assert.equal(account.data.user.id,old.data.user.id)
  assert.equal((await call(DB,'/session',{cookie:old.cookie})).data.user,null)
  assert.equal((await call(DB,'/login',{method:'POST',body:{email:'customer@example.com',password:'very-secure-old-password'}})).status,401)
  assert.equal(sql.prepare("SELECT password_hash FROM users WHERE email='customer@example.com'").get().password_hash,'')
})

test('Google uses cookie state and PKCE, rejects replay/unverified email, and reuses account identity',async t=>{
  const {sql,DB}=database();let verified=true,exchanges=0,subject='google-test-subject'
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url)==='https://oauth2.googleapis.com/token') {
      exchanges++;const data=new URLSearchParams(options.body)
      assert.equal(data.get('redirect_uri'),'https://madarom.example/api/auth/google/callback')
      assert.equal(data.get('code_verifier').length,64)
      return Response.json({access_token:'test-access-token'})
    }
    assert.equal(String(url),'https://openidconnect.googleapis.com/v1/userinfo')
    return Response.json({sub:subject,email:'google@gmail.com',email_verified:verified,name:'לקוח Google'})
  })
  async function start(){const response=await call(DB,'/auth/google/start',{env:providers});assert.equal(response.status,302);const url=new URL(response.headers.get('location'));assert.equal(url.searchParams.get('code_challenge_method'),'S256');return {response,state:url.searchParams.get('state')}}
  const first=await start()
  assert.equal((await call(DB,`/auth/google/callback?state=${first.state}&code=test`,{env:providers})).headers.get('location'),'/login?error=google')
  assert.equal(exchanges,0)
  const done=await call(DB,`/auth/google/callback?state=${first.state}&code=test`,{env:providers,cookie:first.response.cookie})
  assert.equal(done.headers.get('location'),'https://madarom.example/account')
  assert.match(done.headers.get('set-cookie'),/madarom_session=/)
  const second=await start()
  await call(DB,`/auth/google/callback?state=${second.state}&code=test`,{env:providers,cookie:second.response.cookie})
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM users WHERE email='google@gmail.com'").get().n,1)
  assert.equal((await call(DB,`/auth/google/callback?state=${first.state}&code=test`,{env:providers,cookie:first.response.cookie})).headers.get('location'),'/login?error=google')
  verified=false;subject='unverified-subject';const bad=await start()
  assert.equal((await call(DB,`/auth/google/callback?state=${bad.state}&code=test`,{env:providers,cookie:bad.response.cookie})).headers.get('location'),'/login?error=google')
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE provider_subject='unverified-subject'").get().n,0)
})

test('unverified password registration stays closed and notification count spans all unread rows',async t=>{
  const {sql,DB}=database(),messages=delivery(t),account=await emailAccount(DB,messages)
  for(let i=0;i<110;i++)sql.prepare('INSERT INTO notifications(id,user_id,type,title,message,dedupe_key) VALUES (?,?,?,?,?,?)').run(randomUUID(),account.data.user.id,'test','התראת בדיקה','הודעת בדיקה',`notification-${i}`)
  const all=await call(DB,'/notifications',{cookie:account.cookie})
  assert.equal(all.data.notifications.length,100);assert.equal(all.data.unread,110)
  const another=await emailAccount(DB,messages,'another@example.com')
  assert.equal((await call(DB,`/notifications/${all.data.notifications[0].id}`,{method:'PATCH',cookie:another.cookie})).status,404)
  await call(DB,'/notifications/read-all',{method:'PATCH',cookie:account.cookie})
  assert.equal((await call(DB,'/notifications',{cookie:account.cookie})).data.unread,0)
  assert.equal((await call(DB,'/register',{method:'POST',body:{name:'לקוח בדיקה',email:'unverified@example.com',password:'secure-register-password'}})).status,403)
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM users WHERE email='unverified@example.com'").get().n,0)
})

test('external Google email requires authenticated linking before access to staff privileges',async t=>{
  const {sql,DB}=database(),messages=delivery(t),id=randomUUID()
  sql.prepare("INSERT INTO users(id,email,name,role) VALUES (?,?,?,'admin')").run(id,'admin@example.com','מנהל בדיקה')
  const account=await emailAccount(DB,messages,'admin@example.com')
  t.mock.method(globalThis,'fetch',async url=>String(url)==='https://oauth2.googleapis.com/token'
    ?Response.json({access_token:'test-only'})
    :Response.json({sub:'external-staff-sub',email:'admin@example.com',email_verified:true,name:'מנהל בדיקה'}))
  async function start(link=false){const response=await call(DB,`/auth/google/start${link?'?link=1':''}`,{env:providers,cookie:link?account.cookie:undefined});return {response,state:new URL(response.headers.get('location')).searchParams.get('state')}}
  const unlinked=await start()
  assert.equal((await call(DB,`/auth/google/callback?state=${unlinked.state}&code=test`,{env:providers,cookie:unlinked.response.cookie})).headers.get('location'),'/login?error=google')
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE provider='google'").get().n,0)
  assert.equal((await call(DB,'/auth/google/start?link=1',{env:providers})).status,401)
  const lostSession=await start(true)
  assert.equal((await call(DB,`/auth/google/callback?state=${lostSession.state}&code=test`,{env:providers,cookie:lostSession.response.cookie})).headers.get('location'),'/login?error=google')
  const linked=await start(true)
  const done=await call(DB,`/auth/google/callback?state=${linked.state}&code=test`,{env:providers,cookie:linked.response.cookie+'; '+account.cookie})
  assert.equal(done.headers.get('location'),'https://madarom.example/admin')
  assert.equal(sql.prepare("SELECT user_id FROM auth_identities WHERE provider='google'").get().user_id,id)
  assert.equal((await call(DB,'/auth/status',{cookie:account.cookie})).data.google_linked,true)
  const returning=await start()
  assert.equal((await call(DB,`/auth/google/callback?state=${returning.state}&code=test`,{env:providers,cookie:returning.response.cookie})).headers.get('location'),'https://madarom.example/admin')
})

test('original flash-sms provider delivers a private OTP and rejects failed delivery',async t=>{
  const {sql,DB}=database(),messages=delivery(t)
  const account=await emailAccount(DB,messages)
  const worker={SMS_WORKER_URL:'https://flash-sms.shmuelilani14789.workers.dev',SMS_WORKER_SECRET:'test-secret'}
  const captured=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(String(url),new URL(worker.SMS_WORKER_URL).href)
    captured.push(JSON.parse(options.body))
    return captured.length===1?Response.json({success:true}):captured.length===2?Response.json({success:false}):Response.json({})
  })
  const cap=await call(DB,'/auth/capabilities',{env:worker})
  assert.equal(cap.data.sms,true)
  const sent=await call(DB,'/auth/request-code',{method:'POST',cookie:account.cookie,env:worker,
    body:{channel:'sms',target:'0501234567',purpose:'verify'}})
  assert.equal(sent.status,201)
  assert.equal(captured[0].phone,'+972501234567');assert.equal(captured[0].secret,'test-secret');assert.equal(captured[0].count,1)
  assert.equal(JSON.stringify(sent.data).includes('test-secret'),false)
  const verified=await call(DB,'/auth/verify-code',{method:'POST',cookie:account.cookie,
    body:{challenge_id:sent.data.challenge_id,code:captured[0].message.match(/\b\d{6}\b/)[0]}})
  assert.equal(verified.status,200)
  const rejected=await call(DB,'/auth/request-code',{method:'POST',cookie:account.cookie,env:worker,
    body:{channel:'sms',target:'0501234568',purpose:'verify'}})
  assert.equal(rejected.status,503)
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM verification_challenges WHERE target='+972501234568'").get().n,0)
  const missingSuccess=await call(DB,'/auth/request-code',{method:'POST',cookie:account.cookie,env:worker,
    body:{channel:'sms',target:'0501234569',purpose:'verify'}})
  assert.equal(missingSuccess.status,503)
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM verification_challenges WHERE target='+972501234569'").get().n,0)
})

test('Google Identity restores Client ID sign-in with JWT signature, audience, nonce, expiry and role checks',async t=>{
  const {sql,DB}=database(),env={GOOGLE_CLIENT_ID:'test-gis-client'}
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(String(url),'https://www.googleapis.com/oauth2/v3/certs')
    return Response.json({keys:[publicJwk]},{headers:{'cache-control':'public,max-age=3600'}})
  })
  const cap=await call(DB,'/auth/capabilities',{env})
  assert.equal(cap.data.google,true);assert.equal(cap.data.google_mode,'identity')
  const sign=async(nonce,overrides={},key=signing.privateKey)=>new SignJWT({email:'identity@gmail.com',email_verified:true,name:'לקוח',nonce,...overrides})
    .setProtectedHeader({alg:'RS256',kid:'test-rsa'}).setIssuer('https://accounts.google.com').setAudience(overrides.aud||env.GOOGLE_CLIENT_ID)
    .setSubject('identity-subject').setIssuedAt().setExpirationTime(overrides.exp||'5m').sign(key)
  const start=()=>call(DB,'/auth/google/identity/start',{env})
  const verify=(initial,credential,cookie=initial.cookie)=>call(DB,'/auth/google/identity/verify',{method:'POST',cookie,env,body:{credential}})
  const initial=await start(),token=await sign(initial.data.nonce)
  assert.equal((await verify(initial,token,'')).status,401)
  assert.equal((await verify(initial,await sign('wrong-nonce'))).status,401)
  assert.equal((await verify(initial,await sign(initial.data.nonce,{aud:'another-app'}))).status,401)
  assert.equal((await verify(initial,await sign(initial.data.nonce,{exp:Math.floor(Date.now()/1000)-60}))).status,401)
  const attacker=await generateKeyPair('RS256')
  assert.equal((await verify(initial,await sign(initial.data.nonce,{},attacker.privateKey))).status,401)
  const done=await verify(initial,token)
  assert.equal(done.status,200);assert.equal(done.data.redirect,'/account');assert.equal(done.data.user.role,'customer')
  assert.equal((await verify(initial,token)).status,401)
  assert.equal((await call(DB,'/session',{cookie:done.cookie})).data.user.id,done.data.user.id)
  assert.equal((await call(DB,'/account',{cookie:done.cookie})).data.google_linked,true)
  sql.prepare("UPDATE users SET role='admin' WHERE id=?").run(done.data.user.id)
  const returning=await start(),again=await verify(returning,await sign(returning.data.nonce))
  assert.equal(again.data.redirect,'/admin');assert.equal(again.data.user.id,done.data.user.id)
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM users WHERE email='identity@gmail.com'").get().n,1)
})

test('Gmail linking verifies the email of existing staff without changing their role or credentials',async t=>{
  const {sql,DB}=database(),env={GOOGLE_CLIENT_ID:'test-gis-client'},salt='test-staff-salt',password='staff-password-for-test'
  const store=randomUUID()
  sql.prepare('INSERT INTO stores(id,slug,name,category) VALUES (?,?,?,?)').run(store,'staff-google','חנות בדיקה','בית')
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(String(url),'https://www.googleapis.com/oauth2/v3/certs')
    return Response.json({keys:[publicJwk]},{headers:{'cache-control':'public,max-age=3600'}})
  })
  for(const role of ['merchant','admin']) {
    const id=randomUUID(),email=`${role}-link@gmail.com`,hash=pbkdf2Sync(password,salt,210000,32,'sha256').toString('hex')
    sql.prepare('INSERT INTO users(id,email,name,role,store_id,password_salt,password_hash) VALUES (?,?,?,?,?,?,?)')
      .run(id,email,'משתמש בדיקה',role,role==='merchant'?store:null,salt,hash)
    const login=await call(DB,'/login',{method:'POST',body:{email,password}})
    assert.equal(login.status,200)
    assert.equal((await call(DB,'/auth/status',{cookie:login.cookie})).data.email_verified,false)
    const start=await call(DB,'/auth/google/identity/start?link=1',{env,cookie:login.cookie})
    const credential=await new SignJWT({email,email_verified:true,name:'משתמש בדיקה',nonce:start.data.nonce})
      .setProtectedHeader({alg:'RS256',kid:'test-rsa'}).setIssuer('https://accounts.google.com').setAudience(env.GOOGLE_CLIENT_ID)
      .setSubject(`${role}-link-subject`).setIssuedAt().setExpirationTime('5m').sign(signing.privateKey)
    const linked=await call(DB,'/auth/google/identity/verify',{method:'POST',env,cookie:start.cookie+'; '+login.cookie,body:{credential}})
    assert.equal(linked.status,200);assert.equal(linked.data.user.id,id);assert.equal(linked.data.redirect,`/${role}`)
    const status=(await call(DB,'/auth/status',{cookie:login.cookie})).data
    assert.equal(status.google_linked,true);assert.equal(status.email_verified,true)
    assert.equal(sql.prepare('SELECT password_hash FROM users WHERE id=?').get(id).password_hash,hash)
  }
})

test('historical MAIL_FROM is accepted, EMAIL_FROM takes precedence, and malformed Resend success is rejected',async t=>{
  const {sql,DB}=database(),env={RESEND_API_KEY:'test-only',MAIL_FROM:'Madarom <auth@example.com>'}
  let result={id:'test-message'},captured
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(String(url),'https://api.resend.com/emails')
    captured=JSON.parse(options.body)
    return Response.json(result)
  })
  assert.equal((await call(DB,'/auth/capabilities',{env})).data.email,true)
  const sent=await call(DB,'/auth/request-code',{method:'POST',env,body:{channel:'email',target:'alias-buyer@example.com',name:'לקוח'}})
  assert.equal(sent.status,201);assert.equal(captured.from,env.MAIL_FROM)
  assert.equal((await call(DB,'/auth/verify-code',{method:'POST',body:{challenge_id:sent.data.challenge_id,code:captured.text.match(/\b\d{6}\b/)[0]}})).status,200)
  const override={...env,EMAIL_FROM:'Madarom <current@example.com>'}
  assert.equal((await call(DB,'/auth/request-code',{method:'POST',env:override,body:{channel:'email',target:'current-buyer@example.com',name:'לקוח'}})).status,201)
  assert.equal(captured.from,override.EMAIL_FROM)
  for(const [index,bad] of [{},{id:''},{id:123},{id:'message',error:'rejected'}].entries()) {
    result=bad
    const target=`rejected-${index}@example.com`
    assert.equal((await call(DB,'/auth/request-code',{method:'POST',env,body:{channel:'email',target,name:'לקוח'}})).status,503)
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM verification_challenges WHERE target=?').get(target).n,0)
  }
})

test('database readiness detects missing migration tables and catalog returns an actionable 503',async()=>{
  const {sql,DB}=database()
  assert.equal((await call(DB,'/health')).data.ok,true)
  sql.exec('DROP TABLE oauth_states')
  assert.equal((await call(DB,'/auth/capabilities',{env:providers})).data.setup_required,true)
  const health=await call(DB,'/health');assert.equal(health.status,503);assert.equal(health.data.auth_ready,false)
  const missing={prepare(){throw new Error('D1_ERROR: no such table: stores')}}
  const catalog=await call(missing,'/catalog');assert.equal(catalog.status,503);assert.equal(catalog.data.code,'DATABASE_SETUP_REQUIRED')
})

test('SMTP uses the historical settings, requires TLS and never succeeds on rejected delivery',async t=>{
  const {sql,DB}=database(),env={SMTP_HOST:'smtp.example.com',SMTP_PORT:'587',SMTP_USER:'test-user',SMTP_PASS:'test-password',SMTP_FROM:'test@example.com'}
  let reject=false,captured
  globalThis.__testSmtp=async(options,message)=>{
    assert.equal(options.requireTLS,true);assert.equal(options.secure,false)
    assert.equal(options.auth.user,'test-user');assert.equal(options.auth.pass,'test-password')
    captured=message
    return {accepted:reject?[]:[message.to]}
  }
  t.after(()=>{delete globalThis.__testSmtp})
  const cap=await call(DB,'/auth/capabilities',{env});assert.equal(cap.data.email,true)
  assert.equal((await call(DB,'/auth/capabilities',{env:{...env,SMTP_PORT:'25'}})).data.email,false)
  const sent=await call(DB,'/auth/request-code',{method:'POST',env,body:{channel:'email',target:'smtp-buyer@example.com',name:'לקוח'}})
  assert.equal(sent.status,201);assert.equal(captured.to,'smtp-buyer@example.com')
  assert.equal((await call(DB,'/auth/verify-code',{method:'POST',body:{challenge_id:sent.data.challenge_id,code:captured.text.match(/\b\d{6}\b/)[0]}})).status,200)
  reject=true
  assert.equal((await call(DB,'/auth/request-code',{method:'POST',env,body:{channel:'email',target:'rejected@example.com',name:'לקוח'}})).status,503)
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM verification_challenges WHERE target='rejected@example.com'").get().n,0)
})

const owner='shmuelilani14789@gmail.com'
test('platform owner is an admin without a password and signs in only through verified channels',async t=>{
  const {sql,DB}=database(),messages=delivery(t)
  const row=sql.prepare('SELECT id,role,store_id,password_salt,password_hash FROM users WHERE email=?').get(owner)
  assert.equal(row.role,'admin');assert.equal(row.store_id,null);assert.equal(row.password_salt+row.password_hash,'')
  assert.equal((await call(DB,'/login',{method:'POST',body:{email:owner,password:'any-long-password-guess'}})).status,401)
  const login=await emailAccount(DB,messages,owner)
  assert.equal(login.data.user.id,row.id);assert.equal(login.data.user.role,'admin');assert.equal(login.data.redirect,'/admin')
  assert.equal((await call(DB,'/admin/overview',{cookie:login.cookie})).status,200)
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM users WHERE email=?').get(owner).n,1)
})

test('platform owner signs in to the admin area with Google Identity',async t=>{
  const {sql,DB}=database(),env={GOOGLE_CLIENT_ID:'test-gis-client'}
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(String(url),'https://www.googleapis.com/oauth2/v3/certs')
    return Response.json({keys:[publicJwk]},{headers:{'cache-control':'public,max-age=3600'}})
  })
  const start=await call(DB,'/auth/google/identity/start',{env})
  const credential=await new SignJWT({email:owner,email_verified:true,name:'שמואל',nonce:start.data.nonce})
    .setProtectedHeader({alg:'RS256',kid:'test-rsa'}).setIssuer('https://accounts.google.com').setAudience(env.GOOGLE_CLIENT_ID)
    .setSubject('owner-google-subject').setIssuedAt().setExpirationTime('5m').sign(signing.privateKey)
  const done=await call(DB,'/auth/google/identity/verify',{method:'POST',cookie:start.cookie,env,body:{credential}})
  assert.equal(done.status,200);assert.equal(done.data.user.role,'admin');assert.equal(done.data.redirect,'/admin')
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM users WHERE email=?').get(owner).n,1)
  assert.deepEqual((await call(DB,'/auth/status',{cookie:done.cookie})).data,
    {email:owner,email_verified:true,phone:'',phone_verified:false,google_linked:true})
})

test('platform owner verifies a phone from the admin session and then signs in with SMS',async t=>{
  const {sql,DB}=database(),messages=delivery(t),admin=await emailAccount(DB,messages,owner)
  const request=await call(DB,'/auth/request-code',{method:'POST',env:providers,cookie:admin.cookie,body:{channel:'sms',target:'050-1234567',purpose:'verify'}})
  assert.equal(request.status,201);assert.equal(messages.at(-1).to,'+972501234567')
  const verified=await call(DB,'/auth/verify-code',{method:'POST',cookie:admin.cookie,body:{challenge_id:request.data.challenge_id,code:messages.at(-1).code}})
  assert.equal(verified.status,200)
  assert.deepEqual((await call(DB,'/auth/status',{cookie:admin.cookie})).data,
    {email:owner,email_verified:true,phone:'+972501234567',phone_verified:true,google_linked:false})
  sql.prepare("UPDATE verification_challenges SET created_at=datetime('now','-2 minutes')").run()
  const login=await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'sms',target:'0501234567'}})
  const session=await call(DB,'/auth/verify-code',{method:'POST',body:{challenge_id:login.data.challenge_id,code:messages.at(-1).code}})
  assert.equal(session.data.user.id,admin.data.user.id);assert.equal(session.data.redirect,'/admin')
})

test('signed-in staff verify their own email by code and cannot redirect the code elsewhere',async t=>{
  const {sql,DB}=database(),messages=delivery(t),store=randomUUID(),salt='local-test-salt'
  sql.prepare('INSERT INTO stores(id,slug,name,category) VALUES (?,?,?,?)').run(store,'verify-store','חנות בדיקה','בית')
  sql.prepare("INSERT INTO users(id,email,name,role,store_id,password_salt,password_hash) VALUES (?,?,?,'merchant',?,?,?)")
    .run(randomUUID(),'merchant@example.com','סוחר בדיקה',store,salt,pbkdf2Sync('very-secure-merchant-password',salt,210000,32,'sha256').toString('hex'))
  const login=await call(DB,'/login',{method:'POST',body:{email:'merchant@example.com',password:'very-secure-merchant-password'}})
  assert.equal(login.status,200)
  assert.deepEqual((await call(DB,'/auth/status',{cookie:login.cookie})).data,
    {email:'merchant@example.com',email_verified:false,phone:'',phone_verified:false,google_linked:false})
  assert.equal((await call(DB,'/auth/status')).status,401)
  assert.equal((await call(DB,'/auth/request-code',{method:'POST',env:providers,body:{channel:'email',purpose:'verify'}})).status,401)
  const request=await call(DB,'/auth/request-code',{method:'POST',env:providers,cookie:login.cookie,
    body:{channel:'email',purpose:'verify',target:'someone-else@example.com'}})
  assert.equal(request.status,201);assert.equal(messages.at(-1).to,'merchant@example.com')
  assert.equal(sql.prepare('SELECT target FROM verification_challenges WHERE id=?').get(request.data.challenge_id).target,'merchant@example.com')
  const payload={challenge_id:request.data.challenge_id,code:messages.at(-1).code}
  assert.equal((await call(DB,'/auth/verify-code',{method:'POST',body:payload})).status,401)
  const verified=await call(DB,'/auth/verify-code',{method:'POST',cookie:login.cookie,body:payload})
  assert.equal(verified.status,200);assert.equal(verified.data.verified,true)
  assert.equal((await call(DB,'/auth/status',{cookie:login.cookie})).data.email_verified,true)
  assert.equal((await call(DB,'/auth/verify-code',{method:'POST',cookie:login.cookie,body:payload})).status,401)
  assert.equal((await call(DB,'/merchant/overview',{cookie:login.cookie})).status,200)
  assert.equal(sql.prepare("SELECT role FROM users WHERE email='merchant@example.com'").get().role,'merchant')
})

test('owner migration promotes an existing account, revokes its old credentials and leaves an existing admin alone',()=>{
  const migration=readFileSync('migrations/0009_owner_admin.sql','utf8')
  const customer=database('0009_owner_admin.sql'),customerId=randomUUID()
  customer.sql.prepare("INSERT INTO users(id,email,name,role,password_salt,password_hash) VALUES (?,?,?,'customer','salt','hash')").run(customerId,owner.toUpperCase(),'לקוח ישן')
  customer.sql.prepare('INSERT INTO customer_profiles(user_id,phone,email_verified,phone_verified) VALUES (?,?,1,1)').run(customerId,'+972501234567')
  customer.sql.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES (?,?,?,datetime('now','+1 day'))").run(randomUUID(),customerId,'a'.repeat(64))
  customer.sql.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject) VALUES (?,?,'password',?)").run(randomUUID(),customerId,owner)
  customer.sql.exec(migration)
  const promoted=customer.sql.prepare('SELECT id,role,store_id,password_salt,password_hash FROM users WHERE email=?').all(owner)
  assert.equal(promoted.length,1);assert.equal(promoted[0].id,customerId);assert.equal(promoted[0].role,'admin')
  assert.equal(promoted[0].password_salt+promoted[0].password_hash,'')
  assert.equal(customer.sql.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(customerId).n,0)
  assert.equal(customer.sql.prepare('SELECT COUNT(*) n FROM auth_identities WHERE user_id=?').get(customerId).n,0)
  assert.deepEqual({...customer.sql.prepare('SELECT phone,email_verified,phone_verified FROM customer_profiles WHERE user_id=?').get(customerId)},
    {phone:'',email_verified:0,phone_verified:0})

  const merchant=database('0009_owner_admin.sql'),store=randomUUID(),merchantId=randomUUID()
  merchant.sql.prepare('INSERT INTO stores(id,slug,name,category) VALUES (?,?,?,?)').run(store,'owner-store','חנות','בית')
  merchant.sql.prepare("INSERT INTO users(id,email,name,role,store_id) VALUES (?,?,?,'merchant',?)").run(merchantId,owner,'סוחר',store)
  merchant.sql.exec(migration)
  assert.deepEqual({...merchant.sql.prepare('SELECT role,store_id FROM users WHERE id=?').get(merchantId)},{role:'admin',store_id:null})
  assert.equal(merchant.sql.prepare('SELECT COUNT(*) n FROM stores WHERE id=?').get(store).n,1)

  const admin=database('0009_owner_admin.sql'),adminId=randomUUID()
  admin.sql.prepare("INSERT INTO users(id,email,name,role,password_salt,password_hash) VALUES (?,?,?,'admin','salt','hash')").run(adminId,owner,'מנהל קיים')
  admin.sql.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES (?,?,?,datetime('now','+1 day'))").run(randomUUID(),adminId,'b'.repeat(64))
  admin.sql.exec(migration)
  assert.deepEqual({...admin.sql.prepare('SELECT id,name,role,password_hash FROM users WHERE email=?').get(owner)},{id:adminId,name:'מנהל קיים',role:'admin',password_hash:'hash'})
  assert.equal(admin.sql.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(adminId).n,1)
})
