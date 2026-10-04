import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'

const permittedTables=new Set(['stores','users','sessions','products','business_profiles','payment_accounts','invoice_accounts',
  'orders','order_items','order_events','ledger_entries','audit_events','login_attempts','purchase_requests',
  'store_requests','request_items','purchase_request_limits','payment_attempts','payment_webhook_events','refund_requests',
  'customer_profiles','auth_identities','verification_challenges','notifications','auth_rate_limits','oauth_states','d1_migrations'])
const coreColumns={stores:['id','slug','name','category','status'],products:['id','store_id','price_agorot','stock','variants_json'],
  users:['id','email','name','role','store_id','password_salt','password_hash'],sessions:['id','user_id','token_hash','expires_at']}

export function validateDatabaseOwnership(databaseName,rows,databaseId='') {
  const suppliedMadaromDatabase=databaseId==='99c74b64-0934-4c37-8133-fc8cf45ee92f'
  if(databaseId==='c9201b34-d2be-4c95-b981-09ae567c072b'||databaseName==='shmuelnode-db'||
    (!suppliedMadaromDatabase&&!/^(?:madarom|bsd)(?:-|$)/.test(databaseName||'')))
    throw new Error('This database is not named for Madarom or belongs to the other project. Stop: configure a dedicated Madarom database; no migrations were applied.')
  const tables=rows.filter(row=>row.kind==='table').map(row=>row.table_name)
  const foreign=tables.filter(name=>!permittedTables.has(name)&&!name.startsWith('sqlite_')&&!name.startsWith('_cf_'))
  if(foreign.length)throw new Error('D1 contains tables from another application. Stop: use a dedicated Madarom database; no migrations were applied.')
  const applicationTables=tables.filter(name=>!name.startsWith('sqlite_')&&!name.startsWith('_cf_')&&name!=='d1_migrations')
  if(!applicationTables.length) {
    return
  }
  for(const [table,required] of Object.entries(coreColumns)) {
    const columns=rows.filter(row=>row.kind==='column'&&row.table_name===table).map(row=>row.column_name)
    if(required.some(name=>!columns.includes(name)))
      throw new Error('D1 does not match the Madarom schema. Stop: verify the DB binding before migrating; no migrations were applied.')
  }
}

const inspection=`SELECT 'table' kind,name table_name,'' column_name FROM sqlite_master WHERE type='table'
  UNION ALL SELECT 'column',m.name,p.name FROM sqlite_master m,pragma_table_info(m.name) p
  WHERE m.type='table' AND m.name IN ('stores','products','users','sessions')`

export function deploymentConfig(args) {
  let configPath=null
  for(let i=0;i<args.length;i++) {
    const arg=args[i]
    if(arg==='--env'||arg.startsWith('--env=')||arg.startsWith('-e')||arg==='--cwd'||arg.startsWith('--cwd='))
      throw new Error('Use a separate --config for deployment environments so the DB can be inspected safely')
    let value
    if(arg==='--config'||arg==='-c')value=args[++i]
    else if(arg.startsWith('--config='))value=arg.slice(9)
    else if(arg.startsWith('-c')&&!arg.startsWith('--'))value=arg.slice(2).replace(/^=/,'')
    else continue
    if(!value||value.startsWith('-'))throw new Error('A config path is required')
    if(configPath)throw new Error('Use one explicit deployment configuration')
    configPath=value
  }
  return configPath||'wrangler.jsonc'
}
export function deploy(args=process.argv.slice(2)) {
  const configPath=deploymentConfig(args)
  const parsed=ts.parseConfigFileTextToJson(configPath,readFileSync(configPath,'utf8'))
  if(parsed.error)throw new Error('Invalid Wrangler configuration')
  const config=parsed.config
  const db=config.d1_databases?.find(entry=>entry.binding==='DB')
  if(!db?.database_id)throw new Error('Configure a dedicated D1 database ID before deployment')
  const wrangler=resolve('node_modules/wrangler/bin/wrangler.js')
  const run=(command,stdio='inherit')=>execFileSync(process.execPath,[wrangler,...command],{stdio,encoding:'utf8'})
  if(args.includes('--dry-run'))return run(['deploy',...args])
  validateDatabaseOwnership(db.database_name,[],db.database_id)
  let output
  try{output=run(['d1','execute','DB','--remote','--config',configPath,'--command',inspection,'--json'],['ignore','pipe','inherit'])}
  catch{throw new Error('Cannot inspect the configured D1. Check Cloudflare sign-in and D1 permissions. No migrations were applied.')}
  const response=JSON.parse(output)
  if(!Array.isArray(response)||response.some(item=>item.success===false))throw new Error('Database inspection failed; no migrations were applied')
  validateDatabaseOwnership(db.database_name,response.flatMap(item=>item.results||[]),db.database_id)
  // Wrangler applies each migration once, using its migration history.
  run(['d1','migrations','apply','DB','--remote','--config',configPath])
  run(['deploy',...args])
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{deploy()}catch(cause){console.error(cause.message);process.exitCode=1}
}
