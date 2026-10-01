import type { Database, Statement, User } from './types'
import { body, error, getUser, json, money, randomId, safeText, sha256 } from './security'
import { userNotificationStatement } from './notifications'

type ProductRow = {
  id:string; name:string; store_id:string; store_name:string; price_agorot:number
  stock:number; variants_json:string
}
type Line = {product_id:string; name:string; store_id:string; store_name:string; variant:string; quantity:number; unit_price_agorot:number; line_total_agorot:number}
type CustomerProfile = { phone:string }
type RequestOwner = {request_id:string;user_id:string|null;store_name:string}

export class RequestError extends Error {
  constructor(message:string, public status=400) { super(message) }
}

export async function requestsReady(db:Database) {
  try { await db.prepare('SELECT id FROM purchase_requests LIMIT 1').first(); return true }
  catch { return false }
}

export async function priceBasket(db:Database, input:unknown) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) throw new RequestError('אפשר לשלוח בין פריט אחד ל־30 פריטים')
  const lines:Line[] = []
  const seen = new Set<string>()
  const productQuantities = new Map<string,number>()
  for (const item of input) {
    if (!item || typeof item !== 'object') throw new RequestError('פרטי הסל אינם תקינים')
    const row = item as Record<string,unknown>
    const productId = safeText(row.product_id,70), variant = safeText(row.variant,70)
    const quantity = money(row.quantity)
    if (!/^[\w-]{8,70}$/.test(productId) || quantity === null || quantity < 1 || quantity > 100 ||
      seen.has(`${productId}:${variant}`)) throw new RequestError('פרטי הסל אינם תקינים')
    seen.add(`${productId}:${variant}`)
    const product = await db.prepare(`SELECT p.id,p.name,p.store_id,p.price_agorot,p.stock,p.variants_json,s.name AS store_name
      FROM products p JOIN stores s ON s.id=p.store_id
      WHERE p.id=? AND p.status='active' AND s.status='active'`).bind(productId).first<ProductRow>()
    if (!product) throw new RequestError('אחד המוצרים אינו זמין כעת',409)
    let variants:Array<{name:string;stock:number}>
    try { variants=JSON.parse(product.variants_json) } catch { throw new RequestError('אפשרויות המוצר אינן זמינות',409) }
    const chosen = variants.find(v=>v.name===variant)
    if ((variants.length && !chosen) || (!variants.length && variant)) throw new RequestError('יש לבחור אפשרות זמינה למוצר',409)
    if (product.stock < quantity || (chosen && chosen.stock < quantity)) throw new RequestError(`המלאי של ${product.name} השתנה. עדכנו את הסל`,409)
    const combined=(productQuantities.get(product.id)||0)+quantity
    if (combined>product.stock) throw new RequestError(`המלאי של ${product.name} השתנה. עדכנו את הסל`,409)
    productQuantities.set(product.id,combined)
    const lineTotal = product.price_agorot * quantity
    if (!Number.isSafeInteger(lineTotal)) throw new RequestError('הסכום אינו תקין')
    lines.push({product_id:product.id,name:product.name,store_id:product.store_id,store_name:product.store_name,
      variant,quantity,unit_price_agorot:product.price_agorot,line_total_agorot:lineTotal})
  }
  const groups = [...new Set(lines.map(l=>l.store_id))].map(store_id=>({
    store_id,store_name:lines.find(l=>l.store_id===store_id)!.store_name,
    items:lines.filter(l=>l.store_id===store_id),
    subtotal_agorot:lines.filter(l=>l.store_id===store_id).reduce((sum,l)=>sum+l.line_total_agorot,0),
  }))
  const total_agorot = groups.reduce((sum,g)=>sum+g.subtotal_agorot,0)
  if (!Number.isSafeInteger(total_agorot) || total_agorot <= 0 || total_agorot > 100000000)
    throw new RequestError('הסכום אינו תקין')
  return {groups,total_agorot,currency:'ILS',payment_available:false,
    note:'מחירי המוצרים בלבד. משלוח או איסוף יתואמו ישירות מול כל חנות. לא נגבה תשלום.'}
}

export async function quoteRequest(request:Request,db:Database) {
  const data=await body(request)
  return json(await priceBasket(db,data.items))
}

export async function submitRequest(request:Request,db:Database,user?:User|null) {
  const data=await body(request)
  const sessionUser=user ?? await getUser(request,db)
  const authenticatedCustomer=sessionUser?.role==='customer' ? sessionUser : null
  const profile=authenticatedCustomer
    ? await db.prepare('SELECT phone FROM customer_profiles WHERE user_id=?').bind(authenticatedCustomer.id).first<CustomerProfile>()
    : null
  const enteredName=safeText(data.customer_name,120)
  const enteredEmail=safeText(data.customer_email,254).toLowerCase()
  const enteredPhone=safeText(data.customer_phone,35)
  const customer_name=authenticatedCustomer?.name || enteredName
  const customer_email=authenticatedCustomer?.email.toLowerCase() || enteredEmail
  const customer_phone=safeText(enteredPhone || profile?.phone || '',35)
  const key=safeText(data.idempotency_key,70)
  if (customer_name.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email) ||
    !/^[+0-9 ()-]{7,35}$/.test(customer_phone) || !/^[0-9a-f-]{36}$/.test(key) || data.website)
    throw new RequestError('יש למלא שם, מייל וטלפון תקינים')
  const expected_total_agorot=money(data.expected_total_agorot)
  if (expected_total_agorot===null || expected_total_agorot<1) throw new RequestError('יש לעדכן את סיכום הסל')
  const request_hash=await sha256(JSON.stringify([authenticatedCustomer?.id||'',customer_name,customer_email,customer_phone,data.items,expected_total_agorot]))
  const previous=await db.prepare('SELECT id,request_hash FROM purchase_requests WHERE idempotency_key=?').bind(key).first<{id:string;request_hash:string}>()
  if (previous) {
    if (previous.request_hash!==request_hash) throw new RequestError('הבקשה הזו כבר נשלחה עם סל אחר',409)
    return json({id:previous.id,ok:true,replayed:true})
  }
  const basket=await priceBasket(db,data.items)
  if (basket.total_agorot!==expected_total_agorot) throw new RequestError('המחיר השתנה. בדקו את הסל לפני השליחה',409)
  const identitySource=authenticatedCustomer?.id || request.headers.get('cf-connecting-ip') || customer_email
  const identity_hash=await sha256(identitySource.slice(0,100))
  await db.prepare(`INSERT INTO purchase_request_limits(identity_hash,count,reset_at)
    VALUES (?,1,datetime('now','+1 hour')) ON CONFLICT(identity_hash) DO UPDATE SET
    count=CASE WHEN reset_at<datetime('now') THEN 1 ELSE count+1 END,
    reset_at=CASE WHEN reset_at<datetime('now') THEN datetime('now','+1 hour') ELSE reset_at END`).bind(identity_hash).run()
  const limit=await db.prepare('SELECT count FROM purchase_request_limits WHERE identity_hash=?').bind(identity_hash).first<{count:number}>()
  if ((limit?.count||0)>10) throw new RequestError('נשלחו יותר מדי בקשות. נסו שוב מאוחר יותר',429)
  const id=randomId()
  const statements:Statement[]=[db.prepare(`INSERT INTO purchase_requests
    (id,idempotency_key,request_hash,customer_name,customer_email,customer_phone,total_agorot,user_id)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id,key,request_hash,customer_name,customer_email,customer_phone,basket.total_agorot,authenticatedCustomer?.id||null)]
  if (authenticatedCustomer) {
    statements.push(
      db.prepare('UPDATE customer_profiles SET phone=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?')
        .bind(customer_phone,authenticatedCustomer.id),
      userNotificationStatement(db,authenticatedCustomer.id,{
        type:'purchase_request.created',
        title:'בקשת הרכישה נשלחה',
        message:`הבקשה נשלחה ל־${basket.groups.length} ${basket.groups.length===1?'חנות':'חנויות'} ותופיע בהיסטוריה שלכם.`,
        targetUrl:'/account',
        dedupeKey:`purchase-request:${id}:customer`,
      }),
    )
  }
  for (const group of basket.groups) {
    const storeRequestId=randomId()
    statements.push(db.prepare('INSERT INTO store_requests(id,request_id,store_id,subtotal_agorot) VALUES (?,?,?,?)')
      .bind(storeRequestId,id,group.store_id,group.subtotal_agorot))
    for (const item of group.items) statements.push(db.prepare(`INSERT INTO request_items
      (id,store_request_id,product_id,product_name,variant,quantity,unit_price_agorot) VALUES (?,?,?,?,?,?,?)`)
      .bind(randomId(),storeRequestId,item.product_id,item.name,item.variant,item.quantity,item.unit_price_agorot))
    const storeUsers=(await db.prepare('SELECT id FROM users WHERE store_id=?').bind(group.store_id).all<{id:string}>()).results
    for (const storeUser of storeUsers) statements.push(userNotificationStatement(db,storeUser.id,{
      type:'purchase_request.new',
      title:'בקשת רכישה חדשה',
      message:`התקבלה בקשה חדשה מ${customer_name} וממתינה לטיפול.`,
      targetUrl:'/merchant',
      dedupeKey:`purchase-request:${id}:store:${group.store_id}:${storeUser.id}`,
    }))
  }
  try { await db.batch(statements) }
  catch (cause) {
    const existing=await db.prepare('SELECT id,request_hash FROM purchase_requests WHERE idempotency_key=?').bind(key).first<{id:string;request_hash:string}>()
    if (existing && existing.request_hash===request_hash) return json({id:existing.id,ok:true,replayed:true})
    if (existing) throw new RequestError('הבקשה הזו כבר נשלחה עם סל אחר',409)
    throw cause
  }
  return json({id,ok:true,stores:basket.groups.map(g=>g.store_name)},201)
}

export async function customerRequests(db:Database,userId:string) {
  const requests=(await db.prepare(`SELECT id,status,total_agorot,created_at
    FROM purchase_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 100`).bind(userId).all<Record<string,unknown>>()).results
  const stores=(await db.prepare(`SELECT sr.id,sr.request_id,sr.store_id,s.name AS store_name,sr.status,sr.subtotal_agorot,sr.created_at
    FROM store_requests sr JOIN purchase_requests pr ON pr.id=sr.request_id JOIN stores s ON s.id=sr.store_id
    WHERE pr.user_id=? ORDER BY sr.created_at DESC LIMIT 300`).bind(userId).all<Record<string,unknown>>()).results
  const items=(await db.prepare(`SELECT ri.store_request_id,ri.product_id,ri.product_name,ri.variant,ri.quantity,ri.unit_price_agorot
    FROM request_items ri JOIN store_requests sr ON sr.id=ri.store_request_id
    JOIN purchase_requests pr ON pr.id=sr.request_id WHERE pr.user_id=?
    ORDER BY sr.created_at DESC LIMIT 1000`).bind(userId).all<Record<string,unknown>>()).results
  return requests.map(request=>({
    ...request,
    stores:stores.filter(store=>store.request_id===request.id).map(store=>({
      ...store,
      items:items.filter(item=>item.store_request_id===store.id),
    })),
  }))
}

export async function merchantRequests(db:Database,storeId:string) {
  if (!await requestsReady(db)) return []
  const requests=(await db.prepare(`SELECT sr.id,sr.request_id,sr.status,sr.subtotal_agorot,sr.created_at,
    pr.customer_name,pr.customer_email,pr.customer_phone FROM store_requests sr
    JOIN purchase_requests pr ON pr.id=sr.request_id WHERE sr.store_id=?
    ORDER BY sr.created_at DESC LIMIT 100`).bind(storeId).all<Record<string,unknown>>()).results
  const items=(await db.prepare(`SELECT ri.store_request_id,ri.product_name,ri.variant,ri.quantity,ri.unit_price_agorot
    FROM request_items ri JOIN store_requests sr ON sr.id=ri.store_request_id WHERE sr.store_id=?
    ORDER BY sr.created_at DESC LIMIT 300`).bind(storeId).all<Record<string,unknown>>()).results
  return requests.map(r=>({...r,items:items.filter(i=>i.store_request_id===r.id)}))
}

export async function updateMerchantRequest(request:Request,db:Database,storeId:string,id:string) {
  const data=await body(request), status=safeText(data.status,20)
  if (!['contacted','closed'].includes(status)) return error('סטטוס לא תקין')
  const owner=await db.prepare(`SELECT sr.request_id,pr.user_id,s.name AS store_name
    FROM store_requests sr JOIN purchase_requests pr ON pr.id=sr.request_id
    JOIN stores s ON s.id=sr.store_id WHERE sr.id=? AND sr.store_id=?`)
    .bind(id,storeId).first<RequestOwner>()
  if (!owner) return error('הבקשה אינה זמינה לעדכון',404)
  const result=await db.prepare(`UPDATE store_requests SET status=? WHERE id=? AND store_id=? AND status!='closed'`)
    .bind(status,id,storeId).run() as {meta?:{changes:number}}
  if (!result.meta?.changes) return error('הבקשה אינה זמינה לעדכון',404)
  if (status==='closed') {
    await db.prepare(`UPDATE purchase_requests SET status='closed' WHERE id=? AND NOT EXISTS (
      SELECT 1 FROM store_requests WHERE request_id=? AND status!='closed'
    )`).bind(owner.request_id,owner.request_id).run()
  }
  if (owner.user_id) {
    await userNotificationStatement(db,owner.user_id,{
      type:`purchase_request.${status}`,
      title:status==='contacted'?'החנות מטפלת בבקשה':'הטיפול בחנות נסגר',
      message:`${owner.store_name} עדכנה את מצב בקשת הרכישה שלכם.`,
      targetUrl:'/account',
      dedupeKey:`store-request:${id}:${status}`,
    }).run()
  }
  return json({ok:true})
}
