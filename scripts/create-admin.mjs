import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const email = process.argv[2]?.trim().toLowerCase()
const name = process.argv[3]?.trim() || 'מנהל המערכת'
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !process.stdin.isTTY) {
  console.error('שימוש: npm run admin:create -- admin@example.com "שם המנהל" (במסוף אינטראקטיבי)')
  process.exit(1)
}
function hiddenPrompt(prompt) {
  return new Promise(resolve => {
    process.stdout.write(prompt)
    let value = ''
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    const onData = key => {
      if (key === '\u0003') { process.stdin.setRawMode(false); process.exit(130) }
      if (key === '\r' || key === '\n') {
        process.stdin.off('data', onData)
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdout.write('\n')
        resolve(value)
      } else if (key === '\u007f') value = value.slice(0, -1)
      else if (key >= ' ') value += key
    }
    process.stdin.on('data', onData)
  })
}
const password = await hiddenPrompt('סיסמה חדשה (לפחות 12 תווים, הקלט מוסתר): ')
if (password.length < 12) { console.error('הסיסמה קצרה מדי'); process.exit(1) }
const quote = value => String(value).replaceAll("'", "''")
const salt = randomBytes(32).toString('hex')
const hash = pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex')
const sql = `INSERT INTO users(id,email,name,role,store_id,password_salt,password_hash)
VALUES ('${randomUUID()}','${quote(email)}','${quote(name)}','admin',NULL,'${salt}','${hash}');\n`
writeFileSync('admin-seed.sql', sql, {mode:0o600,flag:'wx'})
console.log('נוצר admin-seed.sql. הפעילו אותו מול D1 ומחקו את הקובץ לאחר מכן.')
