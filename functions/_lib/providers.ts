import type { Env } from './types'

export function providerConfiguration(env:Env) {
  const smtpPort=Number(env.SMTP_PORT||465)
  return {
    email:env.SMTP_HOST&&env.SMTP_USER&&env.SMTP_PASS&&env.SMTP_FROM&&[465,587].includes(smtpPort)?'smtp':
      env.RESEND_API_KEY&&(env.EMAIL_FROM?.trim()||env.MAIL_FROM?.trim())?'resend':null,
    sms:env.SMS_WORKER_URL&&env.SMS_WORKER_SECRET?'worker':
      env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN&&env.TWILIO_FROM?'twilio':null,
  } as const
}

export async function deliverCode(env:Env,channel:'email'|'sms',target:string,code:string) {
  const configured=providerConfiguration(env)
  const text=`קוד הכניסה שלך למדרום: ${code}\nהקוד בתוקף ל־10 דקות. אם לא ביקשת כניסה, אפשר להתעלם מההודעה.`
  if(channel==='email'&&configured.email==='smtp') {
    const {default:nodemailer}=await import('nodemailer')
    const port=Number(env.SMTP_PORT||465)
    const transport=nodemailer.createTransport({host:env.SMTP_HOST,port,secure:port===465,
      requireTLS:port===587,auth:{user:env.SMTP_USER!,pass:env.SMTP_PASS!},
      connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
      disableFileAccess:true,disableUrlAccess:true})
    try {
      const result=await transport.sendMail({from:env.SMTP_FROM,to:target,subject:'קוד הכניסה למדרום',text})
      if(!result.accepted?.length)throw new Error('Delivery rejected')
    } finally {transport.close()}
    return
  }
  let response:Response
  if(channel==='email'&&configured.email==='resend') {
    response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},
      body:JSON.stringify({from:env.EMAIL_FROM?.trim()||env.MAIL_FROM?.trim(),to:[target],subject:'קוד הכניסה למדרום',text}),signal:AbortSignal.timeout(15000)})
    if(response.ok) {
      const result=await response.json().catch(()=>null) as {id?:unknown;error?:unknown}|null
      if(typeof result?.id!=='string'||!result.id||result.error)throw new Error('Email delivery rejected')
    }
  } else if(channel==='sms'&&configured.sms==='worker') {
    const url=new URL(env.SMS_WORKER_URL!)
    if(url.protocol!=='https:'||url.username||url.password)throw new Error('Invalid SMS Worker URL')
    response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({phone:target,secret:env.SMS_WORKER_SECRET,message:text,count:1}),
      redirect:'error',signal:AbortSignal.timeout(15000)})
    if(response.ok) {
      const result=await response.json().catch(()=>null) as {success?:boolean;ok?:boolean;error?:unknown}|null
      if(!result?.success||result?.ok===false||result?.error)throw new Error('SMS delivery rejected')
    }
  } else if(channel==='sms'&&configured.sms==='twilio') {
    const data=new URLSearchParams({To:target,From:env.TWILIO_FROM!,Body:text})
    response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!)}/Messages.json`,
      {method:'POST',headers:{authorization:`Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        'content-type':'application/x-www-form-urlencoded'},body:data,signal:AbortSignal.timeout(15000)})
  } else throw new Error('Provider is not configured')
  if(!response.ok)throw new Error('Delivery rejected')
}
