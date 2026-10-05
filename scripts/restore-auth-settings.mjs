import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'

const root=fileURLToPath(new URL('../',import.meta.url))
const smsUrl='https://flash-sms.shmuelilani14789.workers.dev'

export function authSettings(source,{mailFrom}={}) {
  const env=typeof source==='string'?parseEnv(source.replace(/^\uFEFF/,'')):source
  const settings={},warnings=[]
  if(env.SMS_WORKER_SECRET?.trim()) {
    if(env.SMS_WORKER_URL?.trim()!==smsUrl)throw new Error('SMS settings must target the existing flash-sms Worker.')
    settings.SMS_WORKER_SECRET=env.SMS_WORKER_SECRET
  }
  if(env.GOOGLE_CLIENT_ID?.trim()) {
    const id=env.GOOGLE_CLIENT_ID.trim()
    if(!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id))throw new Error('Invalid Google Client ID.')
  }
  if(env.RESEND_API_KEY?.trim()) {
    const from=(mailFrom||env.EMAIL_FROM||env.MAIL_FROM||'').trim()
    const address=from.match(/<([^<>\s]+)>$/)?.[1]||from
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))warnings.push('Resend sender is missing; email settings were omitted.')
    else if(/@(?:resend\.dev|example\.(?:com|org|net))$/i.test(address))
      warnings.push('The old Resend sender is restricted to testing; supply a verified sender with --mail-from.')
    else {settings.RESEND_API_KEY=env.RESEND_API_KEY;settings.EMAIL_FROM=from;settings.MAIL_FROM=from}
  }
  return {settings,warnings}
}

export function restore(args=process.argv.slice(2),run=spawnSync) {
  const sources=[];let apply=false,mailFrom
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--source'&&args[i+1])sources.push(args[++i])
    else if(args[i]==='--mail-from'&&args[i+1])mailFrom=args[++i]
    else if(args[i]==='--apply')apply=true
    else throw new Error('Use --source path [--source path] [--mail-from verified-sender] [--apply].')
  }
  if(!sources.length)throw new Error('Provide a local copy of the original provider environment file with --source.')
  const source=Object.assign({},...sources.map(path=>parseEnv(readFileSync(path,'utf8').replace(/^\uFEFF/,''))))
  const {settings,warnings}=authSettings(source,{mailFrom})
  const keys=Object.keys(settings)
  for(const warning of warnings)console.log(warning)
  if(!keys.length)throw new Error('No eligible provider settings were found.')
  console.log(`Worker: bsda. Settings: ${keys.join(', ')}. Values remain hidden.`)
  if(!apply){console.log('Inspection only. Add --apply to restore these settings without replacing the live code.');return {keys,applied:false}}
  const configPath=resolve(root,'wrangler.jsonc')
  const config=ts.parseConfigFileTextToJson(configPath,readFileSync(configPath,'utf8')).config
  if(config?.name!=='bsda')throw new Error('The config must target the existing bsda Worker.')
  if(source.GOOGLE_CLIENT_ID?.trim()&&source.GOOGLE_CLIENT_ID.trim()!==config.vars?.GOOGLE_CLIENT_ID)
    throw new Error('The recovered Google Client ID differs from the reviewed live configuration.')
  if(settings.SMS_WORKER_SECRET&&config.vars?.SMS_WORKER_URL!==smsUrl)
    throw new Error('Configure the original SMS Worker URL before restoring its secret.')
  const wrangler=resolve(root,'node_modules/wrangler/bin/wrangler.js')
  const command=(args,input)=>run(process.execPath,[wrangler,...args,'--config',configPath],{
    cwd:root,input,encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe'],
    env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'error'},
  })
  if(command(['whoami','--json']).status!==0)
    throw new Error('Cloudflare authentication is required. Run npx wrangler login in your own terminal; no settings were changed.')
  if(command(['versions','list','--name','bsda','--json']).status!==0)
    throw new Error('Cannot access the existing bsda Worker. Check the account and permissions; no settings were changed.')
  if(command(['secret','bulk','--name','bsda'],JSON.stringify(settings)).status!==0)
    throw new Error('Cloudflare did not confirm the settings update. Check access and then verify /api/auth/capabilities.')
  console.log('Provider settings restored to bsda. Live code, assets and D1 were not replaced. Verify real delivery and Google origin permissions.')
  return {keys,applied:true}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{restore()}catch(error){console.error(error.message);process.exitCode=1}
}
