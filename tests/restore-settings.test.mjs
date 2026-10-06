import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authSettings, restore } from '../scripts/restore-auth-settings.mjs'

const source=`SMS_WORKER_URL=https://flash-sms.shmuelilani14789.workers.dev
SMS_WORKER_SECRET=test-only-sms
GOOGLE_CLIENT_ID=890866755716-1qn066hafgvr4hphv14n7fej9slmmtqc.apps.googleusercontent.com
RESEND_API_KEY=test-only-mail
MAIL_FROM=Madarom <old@resend.dev>
ADMIN_PASSWORD=never-copy
JWT_SECRET=never-copy
DEV_AUTH_BYPASS=true
DEV_EMAIL_OVERRIDE=owner@example.com`

test('restoration copies only approved provider settings and refuses a test-only sender',()=>{
  const {settings,warnings}=authSettings(source)
  assert.deepEqual(Object.keys(settings).sort(),['SMS_WORKER_SECRET'])
  assert.equal(warnings.length,1)
  const real=authSettings(source,{mailFrom:'Madarom <auth@store.example.il>'})
  assert.equal(real.settings.EMAIL_FROM,'Madarom <auth@store.example.il>')
  assert.equal(real.settings.MAIL_FROM,real.settings.EMAIL_FROM)
  assert.equal(real.settings.RESEND_API_KEY,'test-only-mail')
  assert.equal(real.settings.ADMIN_PASSWORD,undefined)
  assert.throws(()=>authSettings(source.replace('https://flash-sms.shmuelilani14789.workers.dev','https://unrelated.example.com')),/existing flash-sms/)
})

test('temporary Resend sender requires explicit selection and never permits placeholders or recipient overrides',()=>{
  const {settings,warnings}=authSettings(source,{allowResendTestDomain:true})
  assert.equal(settings.EMAIL_FROM,'Madarom <old@resend.dev>')
  assert.equal(settings.MAIL_FROM,settings.EMAIL_FROM)
  assert.equal(settings.RESEND_API_KEY,'test-only-mail')
  assert.deepEqual(Object.keys(settings).sort(),['EMAIL_FROM','MAIL_FROM','RESEND_API_KEY','SMS_WORKER_SECRET'])
  assert.equal(settings.DEV_EMAIL_OVERRIDE,undefined)
  assert.equal(settings.DEV_AUTH_BYPASS,undefined)
  assert.match(warnings[0],/account owner/)
  for(const domain of ['example.com','example.org','example.net']) {
    const placeholder=authSettings(source,{allowResendTestDomain:true,mailFrom:`auth@${domain}`})
    assert.equal(placeholder.settings.RESEND_API_KEY,undefined)
    assert.match(placeholder.warnings[0],/placeholder/)
  }
})

test('restoration is read-only by default, stops without auth, and sends secrets through stdin only',()=>{
  const directory=mkdtempSync(join(tmpdir(),'madarom-settings-')),file=join(directory,'provider.env')
  writeFileSync(file,source)
  try {
    assert.equal(restore(['--source',file],()=>{throw new Error('No external commands expected')}).applied,false)
    const denied=[]
    assert.throws(()=>restore(['--source',file,'--apply'],(_bin,args)=>{denied.push(args);return {status:1}}),/authentication is required/)
    assert.equal(denied.length,1)
    const calls=[]
    const result=restore(['--source',file,'--apply'],(_bin,args,options)=>{calls.push({args,input:options.input});return {status:0}})
    assert.equal(result.applied,true);assert.equal(calls.length,3)
    assert.deepEqual(calls[2].args.slice(1,5),['secret','bulk','--name','bsda'])
    assert.equal(JSON.parse(calls[2].input).SMS_WORKER_SECRET,'test-only-sms')
    assert.equal(calls.some(c=>c.args.includes('test-only-sms')),false)
    assert.equal(calls.some(c=>c.args.includes('deploy')||c.args.includes('d1')),false)
    const temporaryCalls=[]
    const temporary=restore(['--source',file,'--allow-resend-test-domain','--apply'],(_bin,args,options)=>{
      temporaryCalls.push({args,input:options.input});return {status:0}
    })
    assert.equal(temporary.applied,true)
    const restored=JSON.parse(temporaryCalls[2].input)
    assert.equal(restored.RESEND_API_KEY,'test-only-mail')
    assert.equal(restored.MAIL_FROM,'Madarom <old@resend.dev>')
    assert.equal(restored.DEV_EMAIL_OVERRIDE,undefined)
    assert.equal(temporaryCalls.some(c=>c.args.includes('test-only-mail')),false)
  } finally {rmSync(directory,{recursive:true,force:true})}
})
