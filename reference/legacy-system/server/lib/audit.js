const fs = require("fs")
const path = require("path")
const { randomUUID } = require("crypto")

const LOG_PATH = path.join(__dirname, "..", "data", "audit.log")

// Append-only log for sensitive platform/merchant actions (refunds, status
// changes, exits). Kept separate from db.json so it isn't rewritten wholesale
// on every save, closer to how a real audit trail should behave.
function recordAudit({ actorRole, actorId, action, target, meta }) {
  const entry = { id: randomUUID(), ts: new Date().toISOString(), actorRole, actorId, action, target, meta: meta || null }
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`)
  return entry
}

function readAudit(limit = 200) {
  if (!fs.existsSync(LOG_PATH)) return []
  const lines = fs.readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean)
  return lines.slice(-limit).reverse().map((line) => JSON.parse(line))
}

module.exports = { recordAudit, readAudit }
