import { useEffect, useState, type FormEvent } from 'react'
import { api, send, type AuthCapabilities } from './api'

export default function PhoneVerification({onVerified}:{onVerified?:()=>void}) {
  const [google,setGoogle]=useState(false)
  const [available,setAvailable]=useState(false),[phone,setPhone]=useState(''),[challenge,setChallenge]=useState(''),[code,setCode]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  useEffect(()=>{api<AuthCapabilities>('/auth/capabilities').then(c=>{setAvailable(c.sms);setGoogle(c.google)}).catch(()=>{})},[])
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('')
    try {
      if(!challenge){const result=await send<{challenge_id:string}>('/auth/request-code','POST',{channel:'sms',target:phone,purpose:'verify'});setChallenge(result.challenge_id);setNotice('שלחנו קוד לטלפון שלכם')}
      else{await send('/auth/verify-code','POST',{challenge_id:challenge,code});setChallenge('');setCode('');setNotice('המספר אומת. מעכשיו אפשר להתחבר עם קוד ב־SMS');onVerified?.()}
    }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  return <><details className="phone-verification"><summary>אימות טלפון לכניסה עם SMS</summary><form className="stack" onSubmit={submit}>
    <p className="muted">אמתו את המספר שלכם כדי להתחבר איתו בפעם הבאה.</p>
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-success" role="status">{notice}</p>}
    {!challenge?<label className="field">מספר טלפון<input type="tel" required dir="ltr" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label>:<label className="field">קוד אימות<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} dir="ltr" value={code} onChange={e=>setCode(e.target.value)}/></label>}
    <button className="button dark" disabled={busy||!available}>{busy?'רגע…':challenge?'אימות המספר':'שליחת קוד'}</button>
    {challenge&&<button type="button" className="text-button" onClick={()=>{setChallenge('');setCode('')}}>קבלת קוד חדש</button>}
    {!available&&<small>כניסה ב־SMS תהיה זמינה לאחר הפעלת השירות באתר.</small>}
  </form></details>{google&&<a className="google-button" href="/api/auth/google/start?link=1">חיבור Google לחשבון</a>}</>
}
