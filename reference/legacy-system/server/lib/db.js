// ─────────────────────────────────────────────────────────────
// db.js — Atomic JSON database
//
// כותב לקובץ tmp ואז rename — על Linux/Mac rename היא אטומית,
// כלומר אין אפשרות לקובץ פגום בקריסה באמצע כתיבה.
// ─────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, "..", "data", "madarom.db.json")

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

// ── State shape ─────────────────────────────────────────────
const emptyState = () => ({
  admins:              [],
  merchants:           [],
  stores:              [],
  products:            [],
  coupons:             [],
  customers:           [],
  authCodes:           [],
  orders:              [],
  checkoutSessions:    [],
  masterOrders:        [],
  orderEvents:         [],
  refundRequests:      [],
  invoices:            [],
  commissionInvoices:  [],
  invoiceSequence:     { customer: 1000, commission: 5000 },
  emailOutbox:         [],
  visits:              [],
  reviews:             [],
 holidays:            [],
  closures:            [],
})

// ── Load ─────────────────────────────────────────────────────
function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = emptyState()
    atomicWrite(DB_PATH, JSON.stringify(initial, null, 2))
    return initial
  }
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8")
    return { ...emptyState(), ...JSON.parse(raw) }
  } catch (err) {
    console.error("[db] Failed to parse DB — starting fresh:", err.message)
    return emptyState()
  }
}

// ── Atomic write: write → tmp → rename ──────────────────────
// fs.renameSync היא atomic על Linux/Mac — מבטיחה שאין קובץ פגום
function atomicWrite(filePath, data) {
  const tmp = filePath + ".tmp"
  fs.writeFileSync(tmp, data, "utf-8")
  fs.renameSync(tmp, filePath)
}

let state = load()

function save() {
  atomicWrite(DB_PATH, JSON.stringify(state, null, 2))
}

// ── Public API ──────────────────────────────────────────────

function getState() {
  return state
}

function persist(mutator) {
  mutator(state)
  save()
  return state
}

module.exports = { getState, persist }
