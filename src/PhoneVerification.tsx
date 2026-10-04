import { useEffect, useState, type FormEvent } from 'react'
import { api, send, type AuthCapabilities } from './api'
import GoogleSignIn from './GoogleSignIn'

type Props={onVerified?:()=>void;defaultPhone?:string;phoneVerified?:boolean;emailVerified?:boolean;googleLinked?:boolean}
export default function PhoneVerification({onVerified,defaultPhone='',phoneVerified,emailVerified,googleLinked}:Props) {
  const [google,setGoogle]=useState(false),[done,setDone]=useState(!!phoneVerified)
  const [identityGoogle,setIdentityGoogle]=useState(false)
  const [available,setAvailable]=useState(false),[phone,setPhone]=useState(defaultPhone),[challenge,setChallenge]=useState(''),[code,setCode]=useState('')
  useEffect(()=>{setDone(!!phoneVerified)},[phoneVerified])
  useEffect(()=>{setPhone(defaultPhone);setChallenge('');setCode('')},[defaultPhone])
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[googleNotice,setGoogleNotice]=useState('')
  useEffect(()=>{api<AuthCapabilities>('/auth/capabilities').then(c=>{setAvailable(c.sms);setGoogle(c.google);setIdentityGoogle(c.google_mode==='identity')}).catch(()=>{})},[])
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('')
    try {
      if(!challenge){const result=await send<{challenge_id:string}>('/auth/request-code','POST',{channel:'sms',target:phone,purpose:'verify'});setChallenge(result.challenge_id);setNotice('שלחנו קוד לטלפון שלכם')}
      else{await send('/auth/verify-code','POST',{challenge_id:challenge,code});setChallenge('');setCode('');setDone(true);setNotice('המספר אומת. מעכשיו אפשר להתחבר עם קוד ב־SMS');onVerified?.()}
    }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  const node=(label:string,ok:boolean|undefined,okText:string,noText:string,n:number)=><div className={`verify-node ${ok?'ok':'pending'}`} role="listitem"><span className="verify-mark" aria-hidden="true">{ok?'✓':n}</span><div><strong>{label}</strong><small>{ok?okText:noText}</small></div></div>
  return <div className="verify-block">{emailVerified!==undefined&&<div className="verify-triangle" role="list" aria-label="מצב אימות החשבון">{node('מייל',emailVerified,'מאומת','טרם אומת',1)}{node('טלפון',done,'מאומת','טרם אומת',2)}{node('Google',!!googleLinked||!!googleNotice,'מחובר',google?'אופציונלי':'לא זמין',3)}</div>}<details className="phone-verification" open={!done&&emailVerified!==undefined}><summary>{done?'אימות הטלפון הושלם':'אימות טלפון לכניסה עם SMS'}</summary>{done?<p className="form-success" role="status">המספר מאומת וזמין לכניסה ב־SMS.</p>:<form className="stack" onSubmit={submit}>
    <p className="muted">אמתו את המספר שלכם כדי להתחבר איתו בפעם הבאה.</p>
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-success" role="status">{notice}</p>}
    {!challenge?<label className="field">מספר טלפון<input type="tel" required dir="ltr" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label>:<label className="field">קוד אימות<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} dir="ltr" value={code} onChange={e=>setCode(e.target.value)}/></label>}
    <button className="button dark" disabled={busy||!available}>{busy?'רגע…':challenge?'אימות המספר':'שליחת קוד'}</button>
    {challenge&&<button type="button" className="text-button" onClick={()=>{setChallenge('');setCode('')}}>קבלת קוד חדש</button>}
    {!available&&<small>כניסה ב־SMS תהיה זמינה לאחר הפעלת השירות באתר.</small>}
  </form>}</details>{google&&!googleLinked&&!googleNotice&&(identityGoogle?<GoogleSignIn link onSuccess={()=>{setGoogleNotice('Google חובר לחשבון');onVerified?.()}}/>:<a className="google-button" href="/api/auth/google/start?link=1">חיבור Google לחשבון</a>)}{googleNotice&&<p className="form-success" role="status">{googleNotice}</p>}</div>
}
