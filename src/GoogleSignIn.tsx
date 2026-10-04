import { useEffect, useRef, useState } from 'react'
import { api, send, type Account } from './api'

type Identity={initialize(options:{client_id:string;nonce:string;callback:(result:{credential:string})=>void;auto_select:boolean}):void;
  renderButton(element:HTMLElement,options:{type:string;theme:string;size:string;text:string;locale:string;width:number}):void}
let sdk:Promise<Identity>|null=null
function loadGoogle() {
  const identity=()=> (window as Window&{google?:{accounts?:{id?:Identity}}}).google?.accounts?.id
  if(identity())return Promise.resolve(identity()!)
  if(!sdk)sdk=new Promise<Identity>((resolve,reject)=>{
    const script=document.createElement('script')
    script.src='https://accounts.google.com/gsi/client';script.async=true
    script.onload=()=>{const client=identity();if(client)resolve(client);else{sdk=null;script.remove();reject(new Error('לא ניתן לטעון את Google'))}}
    script.onerror=()=>{sdk=null;script.remove();reject(new Error('לא ניתן לטעון את Google. בדקו את החיבור ונסו שוב'))}
    document.head.append(script)
  })
  return sdk
}
export default function GoogleSignIn({onSuccess,link=false}:{onSuccess:(user:Account,redirect:string)=>void;link?:boolean}) {
  const element=useRef<HTMLDivElement>(null),success=useRef(onSuccess)
  success.current=onSuccess
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[attempt,setAttempt]=useState(0)
  useEffect(()=>{
    const controller=new AbortController();let cancelled=false
    setError('');setReady(false)
    Promise.all([loadGoogle(),api<{client_id:string;nonce:string}>('/auth/google/identity/start'+(link?'?link=1':''),{signal:controller.signal})])
      .then(([google,config])=>{
        if(cancelled||!element.current)return
        google.initialize({client_id:config.client_id,nonce:config.nonce,auto_select:false,callback:async result=>{
          if(cancelled)return
          setBusy(true);setError('')
          try {
            const login=await send<{user:Account;redirect:string}>('/auth/google/identity/verify','POST',{credential:result.credential})
            if(!cancelled)success.current(login.user,login.redirect)
          } catch(cause){if(!cancelled)setError((cause as Error).message)}
          finally {if(!cancelled)setBusy(false)}
        }})
        element.current.replaceChildren()
        google.renderButton(element.current,{type:'standard',theme:'outline',size:'large',text:link?'continue_with':'signin_with',
          locale:'he',width:Math.min(390,element.current.clientWidth||300)})
        setReady(true)
      }).catch(cause=>{if(!cancelled)setError((cause as Error).message)})
    return()=>{cancelled=true;controller.abort()}
  },[link,attempt])
  return <div className="google-sign-in" aria-busy={busy}>
    {link&&<p>חיבור Google לחשבון</p>}<div ref={element}/>
    {!ready&&!error&&<small role="status">טוענים כניסה עם Google…</small>}
    {busy&&<small role="status">מאמתים את החשבון…</small>}
    {error&&<><p className="form-error" role="alert">{error}</p><button type="button" className="text-button" onClick={()=>setAttempt(v=>v+1)}>ניסיון נוסף עם Google</button></>}
  </div>
}
