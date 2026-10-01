import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, ils, send, type Account, type CustomerAccountData } from './api'

const Arrow = () => <span aria-hidden="true">←</span>
const storeStatus:Record<string,string>={new:'חדשה',contacted:'נוצר קשר',closed:'נסגרה'}
const requestStatus:Record<string,string>={open:'פעילה',closed:'נסגרה'}

function Panel({title,children}:{title:string;children:ReactNode}) {
  return <section className="panel"><div className="panel-heading"><h2>{title}</h2></div>{children}</section>
}

function Empty({text}:{text:string}) {
  return <div className="empty"><span aria-hidden="true">✳</span><p>{text}</p></div>
}

function formatDate(value:string) {
  const normalized=value.includes('T')?value:value.replace(' ','T')+'Z'
  const date=new Date(normalized)
  return Number.isNaN(date.getTime())?value:date.toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'})
}

export default function CustomerAccountPage({user,onLogout,onUserChange}:{
  user:Account|null
  onLogout:()=>void
  onUserChange:(user:Account)=>void
}) {
  const [data,setData]=useState<CustomerAccountData|null>(null)
  const [form,setForm]=useState({name:user?.name||'',phone:''})
  const [errorText,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)

  useEffect(()=>{
    if(user?.role!=='customer') return
    let cancelled=false
    setError('')
    api<CustomerAccountData>('/account').then(next=>{
      if(cancelled) return
      setData(next)
      setForm({name:next.user.name,phone:next.profile?.phone||''})
    }).catch(error=>{if(!cancelled)setError(error.message)})
    return()=>{cancelled=true}
  },[user?.id,user?.role])

  if(!user) return <main className="wrap inner-page"><h1>כניסה לחשבון</h1><p>יש להתחבר כדי להמשיך.</p><Link className="button dark" to="/login">לכניסה <Arrow/></Link></main>
  if(user.role!=='customer') return <main className="wrap inner-page"><h1>האזור הזה מיועד ללקוחות.</h1><Link className="button dark" to="/">חזרה לדף הבית <Arrow/></Link></main>

  async function save(e:FormEvent) {
    e.preventDefault()
    if(busy) return
    setBusy(true);setError('');setNotice('')
    try {
      const next=await send<CustomerAccountData>('/account','PATCH',form)
      setData(next)
      setForm({name:next.user.name,phone:next.profile?.phone||''})
      onUserChange(next.user)
      setNotice('פרטי החשבון נשמרו')
    } catch(error) {
      setError((error as Error).message)
    } finally { setBusy(false) }
  }

  const requests=data?.requests||[]
  const requestedTotal=requests.reduce((sum,request)=>sum+request.total_agorot,0)
  const storeRequests=requests.reduce((sum,request)=>sum+request.stores.length,0)

  return <main className="dashboard wrap">
    <div className="dashboard-top"><div><span className="eyebrow">החשבון שלי</span><h1>שלום, {data?.user.name||user.name}<span className="dot">.</span></h1><p>פרטי החשבון והפעילות שלכם במדרום.</p></div><button className="text-button" onClick={onLogout}>יציאה</button></div>
    {errorText&&<p className="form-error" role="alert">{errorText}</p>}
    {notice&&<p className="form-success" role="status">{notice}</p>}

    <div className="metrics">
      <div className="metric"><small>בקשות רכישה</small><strong>{requests.length}</strong></div>
      <div className="metric"><small>חנויות שטיפלו בבקשות</small><strong>{storeRequests}</strong></div>
      <div className="metric"><small>שווי מוצרים בבקשות</small><strong>{ils(requestedTotal)}</strong></div>
    </div>

    <div className="dashboard-grid">
      <Panel title="פרטי החשבון">
        <form className="stack" onSubmit={save}>
          <label className="field">שם מלא<input required minLength={2} autoComplete="name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
          <label className="field">כתובת מייל<input type="email" value={user.email} readOnly/></label>
          <label className="field">טלפון<input type="tel" autoComplete="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
          <button className="button dark" disabled={busy}>{busy?'שומרים…':'שמירת פרטים'}</button>
        </form>
      </Panel>
      <Panel title="אימות החשבון">
        <p className="muted">אימות מייל: <b>{data?.profile?.email_verified?'מאומת':'טרם אומת'}</b></p>
        <p className="muted">אימות טלפון: <b>{data?.profile?.phone_verified?'מאומת':'טרם אומת'}</b></p>
        <p className="muted">שליחת קוד אימות וכניסה באמצעות Google יופעלו לאחר חיבור ספקי האימות וה־Secrets.</p>
      </Panel>
    </div>

    <Panel title="היסטוריית בקשות רכישה">
      {requests.length?<div className="request-list">{requests.map(request=><article className="request-card" key={request.id}>
        <div className="request-head"><div><strong>בקשה #{request.id.slice(0,8)}</strong><small>{formatDate(request.created_at)} · {ils(request.total_agorot)}</small></div><span className="request-badge">{requestStatus[request.status]||request.status}</span></div>
        <div className="request-items">{request.stores.map(store=><div key={store.id}>
          <strong>{store.store_name} · {storeStatus[store.status]||store.status} · {ils(store.subtotal_agorot)}</strong>
          {store.items.map(item=><span key={`${store.id}-${item.product_id}-${item.variant}`}>{item.product_name}{item.variant?' · '+item.variant:''} × {item.quantity} · {ils(item.unit_price_agorot*item.quantity)}</span>)}
        </div>)}</div>
      </article>)}</div>:<Empty text="עדיין אין פעילות בחשבון. בקשות רכישה שתשלחו בזמן שאתם מחוברים יופיעו כאן."/>}
    </Panel>
  </main>
}
