import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ils, send, type Account, type BasketQuote, type CustomerAccountData, type Product } from './api'

const Arrow = () => <span aria-hidden="true">←</span>

function Empty({text}:{text:string}) {
  return <div className="empty"><span aria-hidden="true">✳</span><p>{text}</p></div>
}

export default function CheckoutPage({items,clear,user}:{
  items:Array<{product:Product;quantity:number}>
  clear:()=>void
  user:Account|null
}) {
  const [quote,setQuote]=useState<BasketQuote|null>(null)
  const [errorText,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [sent,setSent]=useState<string|null>(null)
  const [form,setForm]=useState({customer_name:'',customer_email:'',customer_phone:'',website:''})
  const key=useRef(crypto.randomUUID())
  const basket=items.map(({product,quantity})=>({product_id:product.id,variant:product.selected_variant||'',quantity}))
  const signature=JSON.stringify(basket)
  const isCustomer=user?.role==='customer'

  useEffect(()=>{
    if(!isCustomer) return
    let cancelled=false
    api<CustomerAccountData>('/account').then(account=>{
      if(cancelled) return
      setForm(current=>({
        ...current,
        customer_name:account.user.name,
        customer_email:account.user.email,
        customer_phone:account.profile?.phone||current.customer_phone,
      }))
    }).catch(()=>{})
    return()=>{cancelled=true}
  },[isCustomer,user?.id])

  useEffect(()=>{
    if(!items.length) return
    let cancelled=false
    setQuote(null);setError('')
    send<BasketQuote>('/checkout/quote','POST',{items:basket})
      .then(next=>{if(!cancelled)setQuote(next)})
      .catch(error=>{if(!cancelled)setError(error.message)})
    return()=>{cancelled=true}
  },[signature])

  async function submit(e:FormEvent) {
    e.preventDefault()
    if(!quote||busy) return
    setBusy(true);setError('')
    try {
      const result=await send<{id:string}>('/purchase-requests','POST',{
        ...form,
        items:basket,
        expected_total_agorot:quote.total_agorot,
        idempotency_key:key.current,
      })
      setSent(result.id)
      clear()
    } catch(error) {
      setError((error as Error).message)
    } finally { setBusy(false) }
  }

  if(sent) return <main className="wrap inner-page"><div className="checkout-done">
    <span className="eyebrow">הבקשה נשלחה</span>
    <h1>החנויות קיבלו את הפרטים שלכם<span className="dot">.</span></h1>
    <p>מספר הבקשה: <strong dir="ltr">{sent.slice(0,8)}</strong>. כל חנות תוכל ליצור קשר לתיאום הפריטים, האספקה והתשלום. לא חויבתם באתר.</p>
    <div className="form-actions"><Link className="button dark" to="/catalog">להמשיך לגלות <Arrow/></Link>{isCustomer&&<Link className="text-button" to="/account">לצפייה בהיסטוריה <Arrow/></Link>}</div>
  </div></main>

  return <main className="wrap inner-page checkout-page">
    <div className="page-intro"><span className="eyebrow">הפריטים שבחרתם</span><h1>בקשת רכישה<span className="dot">.</span></h1><p>בודקים את הפרטים ושולחים לכל חנות את הפריטים שלה. לא נגבה תשלום בשלב הזה.</p></div>
    {!items.length?<Empty text="הסל ריק. בחרו מוצר כדי לשלוח בקשה."/>:<div className="checkout-grid"><div>
      {errorText&&<p className="form-error" role="alert">{errorText}</p>}
      {quote?<form className="panel stack" onSubmit={submit}>
        <h2>איך יוצרים איתכם קשר?</h2>
        {isCustomer&&<p className="muted">הפרטים מולאו מהחשבון שלכם. אפשר לעדכן את מספר הטלפון לפני השליחה.</p>}
        {!isCustomer&&<p className="muted">רוצים שהבקשה תישמר בהיסטוריה שלכם? <Link to="/login">התחברו או הירשמו</Link>.</p>}
        <label className="field">שם מלא<input required minLength={2} autoComplete="name" value={form.customer_name} readOnly={isCustomer} onChange={e=>setForm({...form,customer_name:e.target.value})}/></label>
        <label className="field">כתובת מייל<input required type="email" autoComplete="email" value={form.customer_email} readOnly={isCustomer} onChange={e=>setForm({...form,customer_email:e.target.value})}/></label>
        <label className="field">טלפון<input required type="tel" autoComplete="tel" value={form.customer_phone} onChange={e=>setForm({...form,customer_phone:e.target.value})}/></label>
        <input className="sr-only" aria-hidden="true" tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={e=>setForm({...form,website:e.target.value})}/>
        <p className="muted">הפרטים יועברו רק לחנויות שבהן בחרתם מוצרים לצורך טיפול בבקשה.</p>
        <button className="button dark wide" disabled={busy}>{busy?'שולחים…':'שליחת בקשה ללא חיוב'} <Arrow/></button>
      </form>:!errorText&&<p role="status">בודקים מחירים וזמינות…</p>}
      </div><div className="panel checkout-summary"><h2>סיכום הבקשה</h2><button type="button" className="text-button" onClick={()=>{setError('');setQuote(null);send<BasketQuote>('/checkout/quote','POST',{items:basket}).then(setQuote).catch(error=>setError(error.message))}}>בדיקת מחיר וזמינות מחדש</button>{quote?.groups.map(group=><div className="checkout-store" key={group.store_id}><h3>{group.store_name}</h3>{group.items.map(item=><p key={item.product_id+item.variant}><span>{item.name}{item.variant?' · '+item.variant:''} × {item.quantity}</span><b>{ils(item.line_total_agorot)}</b></p>)}<strong>סך החנות: {ils(group.subtotal_agorot)}</strong></div>)}<div className="total"><span>מחירי המוצרים</span><strong>{quote?ils(quote.total_agorot):'—'}</strong></div><small>{quote?.note||'מחירי המוצרים והזמינות ייבדקו בשרת.'}</small></div></div>}
    <p className="checkout-help">בקשה זו אינה הזמנה ששולמה ואינה שומרת מלאי. לאחר חיבור הסליקה יתווסף תשלום מאובטח דרך ספק חיצוני.</p>
  </main>
}
