import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { api, type Account } from './api'
import NotificationCenter from './NotificationCenter'

export default function NotificationHost() {
  const location=useLocation()
  const [user,setUser]=useState<Account|null>(null)
  const [mount,setMount]=useState<Element|null>(null)

  async function refreshSession() {
    try { setUser((await api<{user:Account|null}>('/session')).user) }
    catch { setUser(null) }
  }

  useEffect(()=>{
    const findMount=()=>setMount(document.querySelector('.header-actions'))
    findMount()
    const observer=new MutationObserver(findMount)
    observer.observe(document.body,{childList:true,subtree:true})
    return()=>observer.disconnect()
  },[])

  useEffect(()=>{
    refreshSession()
    const timer=window.setInterval(refreshSession,30000)
    const focus=()=>refreshSession()
    window.addEventListener('focus',focus)
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',focus)}
  },[location.pathname])

  if(!mount||!user)return null
  return createPortal(<NotificationCenter user={user}/>,mount)
}
