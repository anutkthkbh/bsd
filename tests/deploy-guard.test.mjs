import test from 'node:test'
import assert from 'node:assert/strict'
import { deploymentConfig, validateDatabaseOwnership } from '../scripts/deploy.mjs'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

const row=(table,columns)=>[{kind:'table',table_name:table},...columns.map(column_name=>({kind:'column',table_name:table,column_name}))]
const core=[...row('stores',['id','slug','name','category','status']),...row('products',['id','store_id','price_agorot','stock','variants_json']),
  ...row('users',['id','email','name','role','store_id','password_salt','password_hash']),...row('sessions',['id','user_id','token_hash','expires_at'])]
test('deployment refuses a shared or incompatible D1 before any migration',()=>{
  assert.throws(()=>validateDatabaseOwnership('shmuelnode-db',[]),/not named for Madarom/)
  assert.throws(()=>validateDatabaseOwnership('shmuelnode-db',core),/not named for Madarom/)
  assert.throws(()=>validateDatabaseOwnership('madarom-prod',core,'c9201b34-d2be-4c95-b981-09ae567c072b'),/other project/)
  assert.throws(()=>validateDatabaseOwnership('madarom-prod',[{kind:'table',table_name:'projects'},...core]),/another application/)
  assert.throws(()=>validateDatabaseOwnership('madarom-prod',row('users',['id','email','password_hash'])),/does not match/)
  assert.doesNotThrow(()=>validateDatabaseOwnership('madarom-prod',[]))
  assert.doesNotThrow(()=>validateDatabaseOwnership('madarom-prod',core))
  const db=new DatabaseSync(':memory:')
  for(const file of readdirSync('migrations').sort())db.exec(readFileSync('migrations/'+file,'utf8'))
  const rows=db.prepare(`SELECT 'table' kind,name table_name,'' column_name FROM sqlite_master WHERE type='table'
    UNION ALL SELECT 'column',m.name,p.name FROM sqlite_master m,pragma_table_info(m.name) p WHERE m.type='table'`).all()
  assert.doesNotThrow(()=>validateDatabaseOwnership('madarom-prod',rows))
  db.close()
})
test('deployment checks the same config for all CLI forms and refuses environment overrides',()=>{
  for(const args of [['--config','production.jsonc'],['-c','production.jsonc'],['--config=production.jsonc'],['-cproduction.jsonc']])
    assert.equal(deploymentConfig(args),'production.jsonc')
  assert.equal(deploymentConfig(['--dry-run']),'wrangler.jsonc')
  for(const args of [['--env','prod'],['--env=prod'],['-eprod'],['--cwd','other'],['--config'],['--config='],['--config','a','--config=b']])
    assert.throws(()=>deploymentConfig(args))
})
