import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, send, type Account, type Notification, type NotificationsData } from './api'

function formatDate(value:string) {
  const normalized=value.includes('T')?value:value.replace(' ','T')+'Z'
  const date=new Date(normalized)
  return Number.isNaN(date.getTime())?value:date.toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'})
}

const safeTarget=(notification:Notification,user:Account) => {
  if(notification.target_url?.startsWith('/')) return notification.target_url
  return user.role==='merchant'?'/merchant':user.role==='admin'?'/admin':'/account'
}

export default function NotificationCenter({user}:{user:Account|null}) {
  const [data,setData]=useState<NotificationsData>({notifications:[],unread:0})
  const [open,setOpen]=useState(false)
  const [loading,setLoading]=useState(false)
  const rootRef=useRef<HTMLDivElement>(null)

  async function reload(silent=false) {
    if(!user) return
    if(!silent)setLoading(true)
    try { setData(await api<NotificationsData>('/notifications')) }
    catch { /* account navigation should not fail because notifications are unavailable */ }
    finally { if(!silent)setLoading(false) }
  }

  useEffect(()=>{
    if(!user){setData({notifications:[],unread:0});setOpen(false);return}
    reload()
    const timer=window.setInterval(()=>reload(true),60000)
    const onVisible=()=>{if(document.visibilityState==='visible')reload(true)}
    document.addEventListener('visibilitychange',onVisible)
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible)}
  },[user?.id])

  useEffect(()=>{
    if(!open)return
    const outside=(event:MouseEvent)=>{if(rootRef.current&&!rootRef.current.contains(event.target as Node))setOpen(false)}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)}
    document.addEventListener('mousedown',outside)
    document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',escape)}
  },[open])

  if(!user)return null

  async function markRead(id:string) {
    setData(current=>({
      notifications:current.notifications.map(item=>item.id===id?{...item,read_at:item.read_at||new Date().toISOString()}:item),
      unread:Math.max(0,current.unread-(current.notifications.find(item=>item.id===id)?.read_at?0:1)),
    }))
    try { await send(`/notifications/${id}`,'PATCH') }
    catch { reload(true) }
  }

  async function markAll() {
    if(!data.unread)return
    const now=new Date().toISOString()
    setData(current=>({notifications:current.notifications.map(item=>({...item,read_at:item.read_at||now})),unread:0}))
    try { await send('/notifications/read-all','PATCH') }
    catch { reload(true) }
  }

  return <div className="notification-center" ref={rootRef}>
    <button type="button" className="icon-button notification-trigger" aria-label={data.unread?`התראות, ${data.unread} לא נקראו`:'התראות'} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span aria-hidden="true">♢</span>{data.unread>0&&<span className="notification-count">{data.unread>99?'99+':data.unread}</span>}
    </button>
    {open&&<section className="notification-popover" role="dialog" aria-label="התראות">
      <div className="notification-head"><div><small>מרכז עדכונים</small><strong>התראות</strong></div>{data.unread>0&&<button type="button" className="text-button" onClick={markAll}>סימון הכול כנקרא</button>}</div>
      {loading?<p className="notification-empty" role="status">טוענים התראות…</p>:data.notifications.length?<div className="notification-list">
        {data.notifications.map(item=><Link key={item.id} to={safeTarget(item,user)} className={`notification-item ${item.read_at?'':'unread'}`} onClick={()=>{markRead(item.id);setOpen(false)}}>
          <span className="notification-dot" aria-hidden="true"/>
          <span><strong>{item.title}</strong><span>{item.message}</span><small>{formatDate(item.created_at)}</small></span>
        </Link>)}
      </div>:<p className="notification-empty">אין התראות חדשות כרגע.</p>}
    </section>}
  </div>
}
