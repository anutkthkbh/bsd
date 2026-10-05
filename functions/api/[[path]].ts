import type { Context, Database, User } from '../_lib/types'
import { body, error, getUser, json, money, passwordHash, randomId, randomToken, safeText, sameOrigin, sha256, slug, validUrl, verifyPassword } from '../_lib/security'
import { customerRequests, merchantRequests, quoteRequest, RequestError, requestsReady, submitRequest, updateMerchantRequest } from '../_lib/requests'
import { getMedia, uploadMedia } from '../_lib/media'
import { markAllNotificationsRead, markNotificationRead, notificationResponse } from '../_lib/notifications'
import { AuthError, authCapabilities, googleCallback, googleStart, googleIdentityStart, googleIdentityVerify, phoneNumber, requestCode, verificationStatus, verifyCode } from '../_lib/auth'
import { schemaReady, schemaFailure } from '../_lib/schema'

type Row = Record<string, unknown>
const values = <T>(query: Promise<{results:T[]}>) => query.then(result => result.results)
const forbidden = () => error('אין הרשאה לבצע פעולה זו', 403)
const validEmail = (value:string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

async function catalog(db: Database) {
  const [stores, products] = await Promise.all([
    values(db.prepare("SELECT id,slug,name,category,description,city,logo_url FROM stores WHERE status='active' ORDER BY created_at DESC").all<Row>()),
    values(db.prepare(`SELECT p.id,p.store_id,p.slug,p.name,p.category,p.description,p.price_agorot,p.image_url,p.stock,p.variants_json,
      s.name AS store_name,s.slug AS store_slug FROM products p JOIN stores s ON s.id=p.store_id
      WHERE p.status='active' AND s.status='active' ORDER BY p.created_at DESC LIMIT 300`).all<Row>()),
  ])
  return json({ stores, products })
}

async function createSession(request:Request, db:Database, account:User) {
  const token = randomToken()
  await db.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES (?,?,?,datetime('now','+7 days'))")
    .bind(randomId(),account.id,await sha256(token)).run()
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : ''
  return json({user:{id:account.id,email:account.email,name:account.name,role:account.role,store_id:account.store_id}},200,
    {'set-cookie':`madarom_session=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=604800`})
}

async function login(request: Request, db: Database) {
  const data = await body(request)
  const email = safeText(data.email, 254).toLowerCase()
  const password = typeof data.password === 'string' ? data.password : ''
  if (!email || !password) return error('יש להזין כתובת מייל וסיסמה')
  const attempts = await db.prepare('SELECT count,reset_at FROM login_attempts WHERE email=?').bind(email).first<{count:number,reset_at:string}>()
  if (attempts && attempts.count >= 8 && attempts.reset_at > new Date().toISOString().replace('T',' ').slice(0,19)) return error('יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות', 429)
  const account = await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first<User & {password_salt:string,password_hash:string}>()
  const matches = account && account.password_hash && await verifyPassword(password, account.password_salt, account.password_hash)
  if (!matches) {
    await db.prepare(`INSERT INTO login_attempts(email,count,reset_at) VALUES (?,1,datetime('now','+10 minutes'))
      ON CONFLICT(email) DO UPDATE SET count=CASE WHEN reset_at<datetime('now') THEN 1 ELSE count+1 END,
      reset_at=CASE WHEN reset_at<datetime('now') THEN datetime('now','+10 minutes') ELSE reset_at END`).bind(email).run()
    return error('פרטי הכניסה אינם נכונים', 401)
  }
  await db.prepare('DELETE FROM login_attempts WHERE email=?').bind(email).run()
  return createSession(request,db,account)
}

async function customerAccount(db:Database,user:User) {
  const [profile,requests,googleIdentity] = await Promise.all([
    db.prepare(`SELECT p.phone,p.email_verified,p.updated_at,
      (p.phone_verified=1 AND EXISTS(SELECT 1 FROM auth_identities a WHERE a.user_id=p.user_id
        AND a.provider='sms_code' AND a.provider_subject=p.phone)) AS phone_verified
      FROM customer_profiles p WHERE p.user_id=?`).bind(user.id).first<Row>(),
    customerRequests(db,user.id),
    db.prepare("SELECT id FROM auth_identities WHERE user_id=? AND provider='google' LIMIT 1").bind(user.id).first<Row>(),
  ])
  return json({user,profile,requests,google_linked:!!googleIdentity})
}

async function updateCustomerAccount(request:Request,db:Database,user:User) {
  const data=await body(request)
  const name=safeText(data.name,120)
  const rawPhone=safeText(data.phone,35)
  const phone=rawPhone?phoneNumber(rawPhone):''
  if (name.length<2) return error('יש להזין שם מלא')
  if (rawPhone && !phone) return error('מספר הטלפון אינו תקין')
  await db.batch([
    db.prepare('UPDATE users SET name=? WHERE id=? AND role=\'customer\'').bind(name,user.id),
    db.prepare(`INSERT INTO customer_profiles(user_id,phone,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,
      phone_verified=CASE WHEN phone=excluded.phone THEN phone_verified ELSE 0 END,updated_at=CURRENT_TIMESTAMP`).bind(user.id,phone),
    db.prepare("DELETE FROM auth_identities WHERE user_id=? AND provider='sms_code' AND provider_subject<>?")
      .bind(user.id,phoneNumber(phone)),
    db.prepare('INSERT INTO audit_events(id,actor_id,action,target_id,detail_json) VALUES (?,?,?,?,?)')
      .bind(randomId(),user.id,'customer.profile.update',user.id,JSON.stringify({phone_updated:true})),
  ])
  return await customerAccount(db,{...user,name})
}

async function merchantOverview(db: Database, user: User) {
  const id = user.store_id
  const [store, products, orders, ledger, profile, payment, invoice, requests] = await Promise.all([
    db.prepare('SELECT * FROM stores WHERE id=?').bind(id).first<Row>(),
    values(db.prepare('SELECT * FROM products WHERE store_id=? ORDER BY created_at DESC').bind(id).all<Row>()),
    values(db.prepare('SELECT * FROM orders WHERE store_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all<Row>()),
    values(db.prepare('SELECT id,kind,amount_agorot,order_id,created_at FROM ledger_entries WHERE store_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all<Row>()),
    db.prepare('SELECT * FROM business_profiles WHERE store_id=?').bind(id).first<Row>(),
    db.prepare('SELECT provider,onboarding_status,charges_enabled,payouts_enabled FROM payment_accounts WHERE store_id=?').bind(id).first<Row>(),
    db.prepare('SELECT provider,connection_status FROM invoice_accounts WHERE store_id=?').bind(id).first<Row>(),
    merchantRequests(db,id!),
  ])
  return json({store,products,orders,ledger,profile,payment,invoice,requests})
}

function parseVariants(input: unknown): string | null {
  if (!Array.isArray(input) || input.length > 30) return null
  const entries: Array<{name:string,stock:number}> = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') return null
    const item = entry as Row
    const name = safeText(item.name, 70), stock = money(item.stock)
    if (!name || stock === null || stock > 100000) return null
    entries.push({name,stock})
  }
  return JSON.stringify(entries)
}

async function saveProduct(request: Request, db: Database, user: User, id?: string) {
  const data = await body(request)
  const name = safeText(data.name, 120), category = safeText(data.category, 70)
  const price = money(data.price_agorot), stock = money(data.stock), variants = parseVariants(data.variants ?? [])
  const description = safeText(data.description, 3000)
  const uploadedImage=safeText(data.image_url,160)
  const image=/^\/api\/media\/([\w-]+)\/[0-9a-f-]{36}\.(jpg|png|webp)$/.exec(uploadedImage)?.[1]===user.store_id
    ? uploadedImage : validUrl(data.image_url)
  const status = data.status === 'active' ? 'active' : 'draft'
  if (!name || !category || price === null || stock === null || stock > 100000 || variants === null) return error('יש לבדוק שם, קטגוריה, מחיר, מלאי ואפשרויות')
  if (data.image_url && !image) return error('קישור התמונה חייב להתחיל ב־https')
  if (id) {
    const existing = await db.prepare('SELECT id FROM products WHERE id=? AND store_id=?').bind(id,user.store_id).first()
    if (!existing) return error('המוצר לא נמצא',404)
    await db.batch([
      db.prepare("UPDATE products SET name=?,category=?,description=?,price_agorot=?,image_url=?,stock=?,status=?,variants_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=?")
        .bind(name,category,description,price,image,stock,status,variants,id,user.store_id),
      db.prepare('INSERT INTO audit_events(id,actor_id,store_id,action,target_id) VALUES (?,?,?,?,?)')
        .bind(randomId(),user.id,user.store_id,'product.update',id),
    ])
  } else {
    id = randomId()
    await db.batch([
      db.prepare('INSERT INTO products(id,store_id,slug,name,category,description,price_agorot,image_url,stock,status,variants_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id,user.store_id,`${slug(name) || 'product'}-${id.slice(0,8)}`,name,category,description,price,image,stock,status,variants),
      db.prepare('INSERT INTO audit_events(id,actor_id,store_id,action,target_id) VALUES (?,?,?,?,?)')
        .bind(randomId(),user.id,user.store_id,'product.create',id),
    ])
  }
  return json({id,ok:true})
}

async function profile(request: Request, db: Database, user: User) {
  const data = await body(request)
  const legal = safeText(data.legal_name, 160), registration = safeText(data.registration_number, 30)
  const entity = safeText(data.entity_type, 60), email = safeText(data.contact_email, 254), phone = safeText(data.contact_phone, 35)
  const storeName = safeText(data.store_name, 120), description = safeText(data.description, 1000), city = safeText(data.city, 80)
  if (!storeName || !legal || !email || !validEmail(email)) return error('יש למלא שם חנות, שם משפטי ומייל תקין')
  await db.batch([
    db.prepare('UPDATE stores SET name=?,description=?,city=? WHERE id=?').bind(storeName,description,city,user.store_id),
    db.prepare(`INSERT INTO business_profiles(store_id,legal_name,entity_type,registration_number,contact_email,contact_phone,status)
      VALUES (?,?,?,?,?,?,'submitted') ON CONFLICT(store_id) DO UPDATE SET legal_name=excluded.legal_name,
      entity_type=excluded.entity_type,registration_number=excluded.registration_number,contact_email=excluded.contact_email,
      contact_phone=excluded.contact_phone,status='submitted'`).bind(user.store_id,legal,entity,registration,email,phone),
    db.prepare('INSERT INTO audit_events(id,actor_id,store_id,action,target_id) VALUES (?,?,?,?,?)')
      .bind(randomId(),user.id,user.store_id,'profile.update',user.store_id),
  ])
  return json({ok:true})
}

async function orderStatus(request: Request, db: Database, user: User, id: string) {
  const data = await body(request)
  const next = safeText(data.status, 30)
  const transitions: Record<string,string[]> = {new:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready'],ready:['shipped','delivered'],shipped:['delivered']}
  const order = await db.prepare('SELECT fulfillment_status,payment_status FROM orders WHERE id=? AND store_id=?').bind(id,user.store_id).first<{fulfillment_status:string,payment_status:string}>()
  if (!order) return error('ההזמנה לא נמצאה',404)
  if (order.payment_status !== 'paid' || !transitions[order.fulfillment_status]?.includes(next)) return error('מעבר סטטוס לא תקין',409)
  const result = await db.batch([
    db.prepare('UPDATE orders SET fulfillment_status=? WHERE id=? AND store_id=? AND fulfillment_status=?').bind(next,id,user.store_id,order.fulfillment_status),
    db.prepare('INSERT INTO order_events(id,order_id,actor_id,from_status,to_status) SELECT ?,?,?,?,? WHERE changes()=1')
      .bind(randomId(),id,user.id,order.fulfillment_status,next),
    db.prepare('INSERT INTO audit_events(id,actor_id,store_id,action,target_id,detail_json) SELECT ?,?,?,?,?,? WHERE changes()=1')
      .bind(randomId(),user.id,user.store_id,'order.status',id,JSON.stringify({from:order.fulfillment_status,to:next})),
  ])
  if ((result[0] as {meta?:{changes:number}})?.meta?.changes === 0) return error('הסטטוס השתנה בינתיים. רעננו ונסו שוב',409)
  return json({ok:true})
}

async function adminOverview(db: Database) {
  const [stores, users] = await Promise.all([
    values(db.prepare('SELECT s.*, (SELECT count(*) FROM products p WHERE p.store_id=s.id) AS product_count FROM stores s ORDER BY created_at DESC').all<Row>()),
    values(db.prepare("SELECT id,email,name,store_id FROM users WHERE role='merchant' ORDER BY created_at DESC").all<Row>()),
  ])
  return json({stores,users})
}
async function createStore(request: Request, db: Database, actor: User) {
  const data = await body(request)
  const name = safeText(data.name,120), email = safeText(data.email,254).toLowerCase(), password = typeof data.password === 'string' ? data.password : ''
  const city = safeText(data.city,80), category = safeText(data.category,70)
  if (!name || !category || !validEmail(email) || password.length < 12) return error('נדרשים שם, קטגוריה, מייל תקין וסיסמה של 12 תווים לפחות')
  const id = randomId(), uid = randomId(), salt = randomToken()
  const link = `${slug(name) || 'store'}-${id.slice(0,8)}`
  try {
    await db.batch([
      db.prepare("INSERT INTO stores(id,slug,name,category,city,status) VALUES (?,?,?,?,?,'draft')").bind(id,link,name,category,city),
      db.prepare("INSERT INTO users(id,email,name,role,store_id,password_salt,password_hash) VALUES (?,?,?,'merchant',?,?,?)")
        .bind(uid,email,name,id,salt,await passwordHash(password,salt)),
      db.prepare("INSERT INTO auth_identities(id,user_id,provider,provider_subject) VALUES (?,?, 'password', ?)").bind(randomId(),uid,email),
      db.prepare('INSERT INTO business_profiles(store_id) VALUES (?)').bind(id),
      db.prepare('INSERT INTO payment_accounts(store_id) VALUES (?)').bind(id),
      db.prepare('INSERT INTO invoice_accounts(store_id) VALUES (?)').bind(id),
      db.prepare('INSERT INTO audit_events(id,actor_id,store_id,action,target_id) VALUES (?,?,?,?,?)')
        .bind(randomId(),actor.id,id,'store.create',id),
    ])
  } catch { return error('לא ניתן ליצור את החנות. בדקו שהמייל ייחודי',409) }
  return json({id,slug:link,ok:true},201)
}

export async function onRequest(context: Context): Promise<Response> {
  const { request } = context, method = request.method
  const path = '/' + ([] as string[]).concat(context.params.path ?? []).join('/')
  const db = context.env.DB
  if (!db) return error('מסד הנתונים עדיין לא חובר. יש להגדיר D1 binding בשם DB ב־Cloudflare',503)
  if (!['GET','POST','PATCH','DELETE'].includes(method)) return error('שיטה לא נתמכת',405)
  if (method !== 'GET' && !sameOrigin(request)) return forbidden()
  try {
    if (path === '/auth/capabilities' && method === 'GET') {
      const ready=await schemaReady(db,'auth')&&await schemaReady(db,'accounts')
      return json(ready?await authCapabilities(context.env):{email:false,sms:false,google:false,setup_required:true})
    }
    if (path === '/auth/google/identity/start' && method === 'GET') return await googleIdentityStart(request,db,context.env)
    if (path === '/auth/google/identity/verify' && method === 'POST') return await googleIdentityVerify(request,db,context.env)
    if (path === '/auth/request-code' && method === 'POST') return await requestCode(request,db,context.env)
    if (path === '/auth/verify-code' && method === 'POST') return await verifyCode(request,db)
    if (path === '/auth/google/start' && method === 'GET') return await googleStart(request,db,context.env)
    if (path === '/auth/google/callback' && method === 'GET') {
      try {return await googleCallback(request,db,context.env)}
      catch {return new Response(null,{status:302,headers:{location:'/login?error=google','cache-control':'no-store'}})}
    }
    if (path === '/health' && method === 'GET') {
      const [catalog,accounts,auth,requests]=await Promise.all([schemaReady(db,'catalog'),schemaReady(db,'accounts'),schemaReady(db,'auth'),requestsReady(db)])
      const ready=catalog&&accounts&&auth&&requests
      return json({ok:ready,catalog_ready:catalog,accounts_ready:accounts,auth_ready:auth,purchase_requests_ready:requests,setup_required:!ready},ready?200:503)
    }
    if (path === '/catalog' && method === 'GET') return await catalog(db)
    if (path.startsWith('/media/') && method === 'GET') return await getMedia(context.env.MEDIA,path.slice('/media/'.length))
    if ((path === '/checkout/quote' || path === '/purchase-requests') && !await requestsReady(db))
      return error('בקשות רכישה יופעלו לאחר עדכון מסד הנתונים',503)
    if (path === '/checkout/quote' && method === 'POST') return await quoteRequest(request,db)
    if (path === '/purchase-requests' && method === 'POST') {
      const customer = await getUser(request,db)
      return await submitRequest(request,db,customer)
    }
    if (path === '/checkout' && method === 'POST') return error('התשלום יופעל רק לאחר חיבור ספק סליקה מאושר',503)
    if (path === '/register' && method === 'POST') return error('להרשמה יש לאמת כתובת מייל באמצעות קוד או Google',403)
    if (path === '/login' && method === 'POST') return await login(request,db)
    const user = await getUser(request,db)
    if (path === '/session' && method === 'GET') return json({user})
    if (path === '/logout' && method === 'POST') {
      const token = /(?:^|;\s*)madarom_session=([0-9a-f]{64})(?:;|$)/.exec(request.headers.get('Cookie') || '')?.[1]
      if (token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run()
      const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : ''
      return json({ok:true},200,{'set-cookie':`madarom_session=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`})
    }
    if (!user) return error('יש להתחבר למערכת',401)
    if (path === '/auth/status' && method === 'GET') return json(await verificationStatus(db,user))
    if (path === '/notifications' && method === 'GET') return await notificationResponse(db,user)
    if (path === '/notifications/read-all' && method === 'PATCH') return await markAllNotificationsRead(db,user)
    const notificationId=/^\/notifications\/([\w-]+)$/.exec(path)?.[1]
    if (notificationId && method === 'PATCH') return await markNotificationRead(db,user,notificationId)
    if (path === '/account' && method === 'GET') {
      if (user.role !== 'customer') return forbidden()
      return await customerAccount(db,user)
    }
    if (path === '/account' && method === 'PATCH') {
      if (user.role !== 'customer') return forbidden()
      return await updateCustomerAccount(request,db,user)
    }
    if (path.startsWith('/merchant/')) {
      if (user.role !== 'merchant' || !user.store_id) return forbidden()
      if (path === '/merchant/overview' && method === 'GET') return await merchantOverview(db,user)
      if (path === '/merchant/media' && method === 'POST') return await uploadMedia(request,context.env.MEDIA,user.store_id)
      const requestId = /^\/merchant\/requests\/([\w-]+)$/.exec(path)?.[1]
      if (requestId && method === 'PATCH') return await updateMerchantRequest(request,db,user.store_id,requestId)
      if (path === '/merchant/profile' && method === 'PATCH') return await profile(request,db,user)
      if (path === '/merchant/products' && method === 'POST') return await saveProduct(request,db,user)
      const productId = /^\/merchant\/products\/([\w-]+)$/.exec(path)?.[1]
      if (productId && method === 'PATCH') return await saveProduct(request,db,user,productId)
      if (productId && method === 'DELETE') {
        const existing = await db.prepare('SELECT id FROM products WHERE id=? AND store_id=?').bind(productId,user.store_id).first()
        if (!existing) return error('המוצר לא נמצא',404)
        await db.batch([
          db.prepare("UPDATE products SET status='archived' WHERE id=? AND store_id=?").bind(productId,user.store_id),
          db.prepare('INSERT INTO audit_events(id,actor_id,store_id,action,target_id) VALUES (?,?,?,?,?)')
            .bind(randomId(),user.id,user.store_id,'product.archive',productId),
        ])
        return json({ok:true})
      }
      const orderId = /^\/merchant\/orders\/([\w-]+)\/status$/.exec(path)?.[1]
      if (orderId && method === 'PATCH') return await orderStatus(request,db,user,orderId)
    }
    if (path.startsWith('/admin/')) {
      if (user.role !== 'admin') return forbidden()
      if (path === '/admin/overview' && method === 'GET') return await adminOverview(db)
      if (path === '/admin/stores' && method === 'POST') return await createStore(request,db,user)
      const storeId = /^\/admin\/stores\/([\w-]+)\/status$/.exec(path)?.[1]
      if (storeId && method === 'PATCH') {
        const data = await body(request), status = safeText(data.status,20)
        if (!['active','draft','paused'].includes(status)) return error('סטטוס לא תקין')
        const existing = await db.prepare('SELECT id FROM stores WHERE id=?').bind(storeId).first()
        if (!existing) return error('החנות לא נמצאה',404)
        await db.batch([
          db.prepare('UPDATE stores SET status=? WHERE id=?').bind(status,storeId),
          db.prepare('INSERT INTO audit_events(id,actor_id,store_id,action,target_id) VALUES (?,?,?,?,?)')
            .bind(randomId(),user.id,storeId,'store.status',storeId),
        ])
        return json({ok:true})
      }
    }
    return error('הנתיב לא נמצא',404)
  } catch (cause) {
    if (cause instanceof AuthError) return error(cause.message,cause.status)
    if (cause instanceof RequestError) return error(cause.message,cause.status)
    if (cause instanceof SyntaxError || cause instanceof Error && /הבקשה גדולה מדי|נתונים לא תקינים/.test(cause.message)) return error('נתונים לא תקינים')
    if (schemaFailure(cause)) {
      console.error('Madarom database schema is not ready')
      return json({error:'המערכת אינה זמינה כרגע. צוות האתר צריך להשלים את ההפעלה',code:'DATABASE_SETUP_REQUIRED'},503)
    }
    console.error('API failure',cause)
    return error('תקלה זמנית. נסו שוב בעוד רגע',500)
  }
}
