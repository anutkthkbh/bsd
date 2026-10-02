import type { Database, Env, User } from './types'
import { body, error, json, randomId, randomToken, safeText, sha256, getUser } from './security'

export class AuthError extends Error {
  constructor(message:string, public status=400) {super(message)}
}
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function phoneNumber(input:unknown) {
  const raw=safeText(input,35).replace(/[\s()-]/g,'')
  const normalized=/^05\d{8}$/.test(raw)?'+972'+raw.slice(1):raw
  return /^\+[1-9]\d{7,14}$/.test(normalized)?normalized:''
}
const redirectFor=(role:User['role'])=>role==='admin'?'/admin':role==='merchant'?'/merchant':'/account'
function cookie(request:Request,name:string,value:string,maxAge:number) {
  const secure=new URL(request.url).protocol==='https:'?' Secure;':''
  return `${name}=${value}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAge}`
}
async function issueSession(request:Request,db:Database,user:User) {
  const token=randomToken()
  await db.prepare(`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES (?,?,?,datetime('now','+7 days'))`)
    .bind(randomId(),user.id,await sha256(token)).run()
  return {user,sessionCookie:cookie(request,'madarom_session',token,604800)}
}
export async function authCapabilities(env:Env) {
  return {email:!!(env.RESEND_API_KEY&&env.EMAIL_FROM),sms:!!(env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN&&env.TWILIO_FROM),
    google:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)}
}

async function deliverCode(env:Env,channel:'email'|'sms',target:string,code:string) {
  let response:Response
  if (channel==='email') {
    response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},
      body:JSON.stringify({from:env.EMAIL_FROM,to:[target],subject:'קוד הכניסה למדרום',
        text:`קוד הכניסה שלך למדרום: ${code}\nהקוד בתוקף ל־10 דקות. אם לא ביקשת כניסה, אפשר להתעלם מההודעה.`})})
  } else {
    const data=new URLSearchParams({To:target,From:env.TWILIO_FROM!,Body:`קוד הכניסה למדרום: ${code}. הקוד בתוקף ל-10 דקות.`})
    response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!)}/Messages.json`,
      {method:'POST',headers:{authorization:`Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        'content-type':'application/x-www-form-urlencoded'},body:data})
  }
  if (!response.ok) throw new AuthError('שליחת הקוד נכשלה. נסו שוב מאוחר יותר',503)
}

export async function requestCode(request:Request,db:Database,env:Env) {
  const data=await body(request),channel=data.channel
  if (channel!=='email'&&channel!=='sms') throw new AuthError('בחרו דרך כניסה')
  const capabilities=await authCapabilities(env)
  if (!capabilities[channel]) throw new AuthError('דרך הכניסה הזו עדיין לא חוברה',503)
  const target=channel==='email'?safeText(data.target,254).toLowerCase():phoneNumber(data.target)
  if (!target || (channel==='email'&&!emailPattern.test(target))) throw new AuthError('הזינו כתובת מייל או מספר טלפון תקינים')
  const name=safeText(data.name,120)
  const purpose=data.purpose==='verify'?'verify':'login'
  const account=purpose==='verify'?await getUser(request,db):null
  if (purpose==='verify'&&(!account||channel!=='sms')) throw new AuthError('יש להתחבר כדי לאמת מספר טלפון',401)
  if (channel==='email'&&name.length<2) {
    const existing=await db.prepare('SELECT id FROM users WHERE email=?').bind(target).first()
    if (!existing) throw new AuthError('להרשמה יש למלא שם מלא')
  }
  if(channel==='sms'&&purpose==='login') {
    const identity=await db.prepare("SELECT user_id FROM auth_identities WHERE provider='sms_code' AND provider_subject=?").bind(target).first()
    if(!identity)throw new AuthError('היכנסו באמצעות מייל או Google ואמתו את המספר באזור האישי',409)
  }
  if (data.website) throw new AuthError('נתונים לא תקינים')
  const recent=await db.prepare(`SELECT id FROM verification_challenges WHERE channel=? AND target=?
    AND created_at>datetime('now','-60 seconds') ORDER BY created_at DESC LIMIT 1`).bind(channel,target).first()
  if (recent) throw new AuthError('המתינו דקה לפני בקשת קוד נוסף',429)
  const ip=safeText(request.headers.get('cf-connecting-ip'),100)||target
  for (const identity of [`target:${channel}:${target}`,`ip:${ip}`]) {
    const hash=await sha256(identity)
    await db.prepare(`INSERT INTO auth_rate_limits(identity_hash,count,reset_at)
      VALUES (?,1,datetime('now','+1 hour')) ON CONFLICT(identity_hash) DO UPDATE SET
      count=CASE WHEN reset_at<datetime('now') THEN 1 ELSE count+1 END,
      reset_at=CASE WHEN reset_at<datetime('now') THEN datetime('now','+1 hour') ELSE reset_at END`).bind(hash).run()
    const limit=await db.prepare('SELECT count FROM auth_rate_limits WHERE identity_hash=?').bind(hash).first<{count:number}>()
    if ((limit?.count||0)>5) throw new AuthError('נשלחו יותר מדי קודים. נסו בעוד שעה',429)
  }
  const id=randomId(),salt=randomToken(),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0')
  await db.prepare(`INSERT INTO verification_challenges(id,channel,target,destination_hash,name,salt,code_hash,purpose,user_id,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now','+10 minutes'))`).bind(id,channel,target,await sha256(target),name,salt,await sha256(`${salt}:${code}`),purpose,account?.id||null).run()
  try {await deliverCode(env,channel,target,code)}
  catch (cause) {await db.prepare('DELETE FROM verification_challenges WHERE id=?').bind(id).run();throw cause}
  return json({challenge_id:id,ok:true},201)
}

// A verified email can reclaim an old, unverified password registration.
// Revoke unverified credentials before issuing the verified owner's session.
async function verifiedEmailAccount(db:Database,email:string,name:string):Promise<User> {
  let user=await db.prepare('SELECT id,email,name,role,store_id FROM users WHERE email=?').bind(email).first<User>()
  if (!user) {
    if (name.length<2) throw new AuthError('להרשמה יש למלא שם מלא')
    const id=randomId()
    await db.batch([
      db.prepare("INSERT INTO users(id,email,name,role,store_id) VALUES (?,?,?,'customer',NULL)").bind(id,email,name),
      db.prepare('INSERT INTO customer_profiles(user_id,email_verified) VALUES (?,1)').bind(id),
    ])
    user={id,email,name,role:'customer',store_id:null}
  } else {
    const profile=await db.prepare('SELECT email_verified FROM customer_profiles WHERE user_id=?').bind(user.id).first<{email_verified:number}>()
    if (user.role==='customer'&&!profile?.email_verified) {
      await db.batch([
        db.prepare("UPDATE users SET password_salt='',password_hash='',name=? WHERE id=?").bind(name.length>=2?name:user.name,user.id),
        db.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),
        db.prepare('DELETE FROM auth_identities WHERE user_id=?').bind(user.id),
        db.prepare("UPDATE customer_profiles SET phone='',phone_verified=0 WHERE user_id=?").bind(user.id),
      ])
      if(name.length>=2)user={...user,name}
    }
    await db.prepare(`INSERT INTO customer_profiles(user_id,email_verified) VALUES (?,1)
      ON CONFLICT(user_id) DO UPDATE SET email_verified=1,updated_at=CURRENT_TIMESTAMP`).bind(user.id).run()
  }
  return user
}
async function linkIdentity(db:Database,user:User,provider:'email_code'|'sms_code'|'google',subject:string) {
  const owner=await db.prepare('SELECT user_id FROM auth_identities WHERE provider=? AND provider_subject=?')
    .bind(provider,subject).first<{user_id:string}>()
  if(owner&&owner.user_id!==user.id)throw new AuthError('פרטי האימות כבר משויכים לחשבון אחר',409)
  await db.prepare(`INSERT INTO auth_identities(id,user_id,provider,provider_subject) VALUES (?,?,?,?)
    ON CONFLICT(provider,provider_subject) DO NOTHING`).bind(randomId(),user.id,provider,subject).run()
  const linked=await db.prepare('SELECT user_id FROM auth_identities WHERE provider=? AND provider_subject=?')
    .bind(provider,subject).first<{user_id:string}>()
  if(linked?.user_id!==user.id)throw new AuthError('פרטי האימות כבר משויכים לחשבון אחר',409)
}

export async function verifyCode(request:Request,db:Database) {
  const data=await body(request),id=safeText(data.challenge_id,70),code=safeText(data.code,10)
  if (!/^[0-9a-f-]{36}$/.test(id)||!/^\d{6}$/.test(code)) throw new AuthError('הקוד אינו תקין')
  const challenge=await db.prepare(`SELECT id,channel,target,name,salt,code_hash,attempts,purpose,user_id FROM verification_challenges
    WHERE id=? AND consumed_at IS NULL AND expires_at>datetime('now')`).bind(id)
    .first<{id:string;channel:'email'|'sms';target:string;name:string;salt:string;code_hash:string;attempts:number;purpose:string;user_id:string|null}>()
  if (!challenge||challenge.attempts>=5) throw new AuthError('הקוד פג תוקף. בקשו קוד חדש',401)
  if (await sha256(`${challenge.salt}:${code}`)!==challenge.code_hash) {
    await db.prepare('UPDATE verification_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL').bind(id).run()
    throw new AuthError('הקוד אינו נכון',401)
  }
  const current=challenge.purpose==='verify'?await getUser(request,db):null
  if(challenge.purpose==='verify'&&(!current||current.id!==challenge.user_id))throw new AuthError('יש להתחבר לחשבון שביקש את האימות',401)
  const used=await db.prepare(`UPDATE verification_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL
    AND expires_at>datetime('now') AND attempts<5`).bind(id).run() as {meta?:{changes:number}}
  if (!used.meta?.changes) throw new AuthError('הקוד כבר נוצל',401)
  let user:User
  if(challenge.purpose==='verify'&&current) {
    await linkIdentity(db,current,'sms_code',challenge.target)
    await db.batch([
      db.prepare("DELETE FROM auth_identities WHERE user_id=? AND provider='sms_code' AND provider_subject<>?").bind(current.id,challenge.target),
      db.prepare(`INSERT INTO customer_profiles(user_id,phone,phone_verified) VALUES (?,?,1)
        ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,phone_verified=1,updated_at=CURRENT_TIMESTAMP`).bind(current.id,challenge.target),
    ])
    return json({ok:true,verified:true})
  } else if(challenge.channel==='email') {
    user=await verifiedEmailAccount(db,challenge.target,challenge.name)
    await linkIdentity(db,user,'email_code',challenge.target)
  } else {
    const found=await db.prepare(`SELECT u.id,u.email,u.name,u.role,u.store_id FROM auth_identities a
      JOIN users u ON u.id=a.user_id WHERE a.provider='sms_code' AND a.provider_subject=?`).bind(challenge.target).first<User>()
    if(!found)throw new AuthError('המספר לא אומת בחשבון. הירשמו במייל או ב־Google ואמתו את הטלפון באזור האישי',409)
    user=found
  }
  const session=await issueSession(request,db,user)
  return json({user:session.user,redirect:redirectFor(user.role)},200,{'set-cookie':session.sessionCookie})
}

function base64url(bytes:Uint8Array) {return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
export async function googleStart(request:Request,db:Database,env:Env) {
  if (!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)) return error('כניסה עם Google עדיין לא חוברה',503)
  const linking=new URL(request.url).searchParams.get('link')==='1'
  const account=linking?await getUser(request,db):null
  if(linking&&!account)throw new AuthError('יש להתחבר כדי לחבר Google לחשבון',401)
  const state=randomToken(),verifier=randomToken(),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))
  await db.prepare(`INSERT INTO oauth_states(state_hash,code_verifier,user_id,expires_at)
    VALUES (?,?,?,datetime('now','+10 minutes'))`).bind(await sha256(state),verifier,account?.id||null).run()
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:new URL('/api/auth/google/callback',request.url).href,
    response_type:'code',scope:'openid email profile',state,code_challenge:base64url(new Uint8Array(digest)),code_challenge_method:'S256',prompt:'select_account'}).toString()
  return new Response(null,{status:302,headers:{location:url.href,'set-cookie':cookie(request,'madarom_oauth',state,600),'cache-control':'no-store'}})
}
export async function googleCallback(request:Request,db:Database,env:Env) {
  const url=new URL(request.url),state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||''
  const cookieState=/(?:^|;\s*)madarom_oauth=([0-9a-f]{64})(?:;|$)/.exec(request.headers.get('cookie')||'')?.[1]
  if (!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!cookieState||state!==cookieState||!code)
    throw new AuthError('האימות עם Google נכשל',401)
  const stateHash=await sha256(state)
  const row=await db.prepare(`SELECT code_verifier,user_id FROM oauth_states WHERE state_hash=? AND expires_at>datetime('now')`)
    .bind(stateHash).first<{code_verifier:string;user_id:string|null}>()
  if (!row) throw new AuthError('האימות עם Google פג תוקף',401)
  const used=await db.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>datetime(\'now\')').bind(stateHash)
    .run() as {meta?:{changes:number}}
  if (!used.meta?.changes) throw new AuthError('האימות עם Google כבר נוצל',401)
  const token=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,
      redirect_uri:new URL('/api/auth/google/callback',request.url).href,grant_type:'authorization_code',code_verifier:row.code_verifier})})
  if (!token.ok) throw new AuthError('האימות עם Google נכשל',401)
  const tokens=await token.json() as {access_token?:string}
  if (!tokens.access_token) throw new AuthError('האימות עם Google נכשל',401)
  const profileResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',
    {headers:{authorization:`Bearer ${tokens.access_token}`}})
  if (!profileResponse.ok) throw new AuthError('לא התקבל פרופיל מאומת מ־Google',401)
  const profile=await profileResponse.json() as {sub?:string;email?:string;email_verified?:boolean;name?:string}
  const email=safeText(profile.email,254).toLowerCase(),sub=safeText(profile.sub,255)
  if (!sub||!emailPattern.test(email)||profile.email_verified!==true) throw new AuthError('כתובת המייל ב־Google אינה מאומתת',401)
  let user=await db.prepare(`SELECT u.id,u.email,u.name,u.role,u.store_id FROM auth_identities a
    JOIN users u ON u.id=a.user_id WHERE a.provider='google' AND a.provider_subject=?`).bind(sub).first<User>()
  if(row.user_id) {
    const current=await getUser(request,db)
    if(!current||current.id!==row.user_id||current.email.toLowerCase()!==email)
      throw new AuthError('יש לחבר Google מתוך החשבון ועם אותה כתובת מייל',401)
    if(user&&user.id!==current.id)throw new AuthError('חשבון Google כבר משויך למשתמש אחר',409)
    user=current
    await linkIdentity(db,user,'google',sub)
  } else if (!user) {
    // Google is authoritative for Gmail. For external emails, link an existing
    // account only from its authenticated session after current ownership proof.
    const authoritative=email.endsWith('@gmail.com')
    if(!authoritative)throw new AuthError('היכנסו עם קוד למייל וחברו Google מתוך החשבון',401)
    user=await verifiedEmailAccount(db,email,safeText(profile.name,120)||email.split('@')[0])
    await linkIdentity(db,user,'google',sub)
  }
  const session=await issueSession(request,db,user)
  const headers=new Headers({location:new URL(redirectFor(user.role),request.url).href,'cache-control':'no-store'})
  headers.append('set-cookie',session.sessionCookie)
  headers.append('set-cookie',cookie(request,'madarom_oauth','',0))
  return new Response(null,{status:302,headers})
}
