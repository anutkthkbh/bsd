import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type VerificationStatus } from './api'
import PhoneVerification from './PhoneVerification'

export default function AccountVerification({revision=0,onVerified}:{revision?:number;onVerified?:()=>void}) {
  const [status,setStatus]=useState<VerificationStatus|null>(null),[failed,setFailed]=useState(false)
  const generation=useRef(0)
  const load=useCallback(()=>{
    const request=++generation.current
    return api<VerificationStatus>('/auth/status').then(next=>{if(request===generation.current){setStatus(next);setFailed(false)}})
      .catch(()=>{if(request===generation.current){setStatus(null);setFailed(true)}})
  },[])
  useEffect(()=>{setStatus(null);setFailed(false);load();return()=>{generation.current++}},[load,revision])
  if(failed)return <div><p className="form-error" role="alert">לא ניתן לטעון את מצב האימות.</p><button type="button" className="text-button" onClick={load}>ניסיון נוסף</button></div>
  if(!status)return <small role="status">טוענים את מצב האימות…</small>
  return <PhoneVerification emailVerified={status.email_verified} phoneVerified={status.phone_verified} googleLinked={status.google_linked}
    defaultPhone={status.phone} onVerified={()=>{load();onVerified?.()}}/>
}
