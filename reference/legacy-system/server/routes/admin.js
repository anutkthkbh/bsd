const { Router } = require("express")
const { randomUUID } = require("crypto")
const { z } = require("zod")
const { getState, persist } = require("../lib/db")
const { requireAuth, hashPassword } = require("../lib/auth")
const { sendMail } = require("../lib/mailer")
const { attachStoreOrders } = require("../lib/checkout")

const router = Router()

router.use(requireAuth("admin"))

const onboardSchema = z.object({
  storeName: z.string().min(2),
  category: z.string().min(2),
  about: z.string().min(2),
  phone: z.string().min(9),
  email: z.string().email(),
  ownerName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerIdNumber: z.string().min(5),
  monthlyAdBudgetCommitted: z.coerce.number().min(0),
})

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, "-").replace(/(^-|-$)/g, "") || randomUUID().slice(0, 8)
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase()
}

// This is the platform-side onboarding CRM: only an admin can open a new store
// on the system. It provisions the store record and the owner's merchant login.
router.post("/stores", async (req, res) => {
  const parsed = onboardSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "פרטים חסרים או לא תקינים", details: parsed.error.issues })

  const ownerEmail = normalizeEmail(parsed.data.ownerEmail)
  const storeEmail = normalizeEmail(parsed.data.email)
  const state = getState()

  if (state.merchants.some((item) => normalizeEmail(item.email) === ownerEmail)) {
    return res.status(409).json({ error: "כבר קיים בעל עסק עם אימייל זה" })
  }

  const store = {
    id: randomUUID(),
    slug: slugify(parsed.data.storeName),
    name: parsed.data.storeName,
    category: parsed.data.category,
    about: parsed.data.about,
    phone: parsed.data.phone,
    email: storeEmail,
    status: "active",
    joinedAt: new Date().toISOString(),
    commitmentEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 182).toISOString(),
    monthlyAdBudgetCommitted: parsed.data.monthlyAdBudgetCommitted,
    monthlyAdBudgetSpent: 0,
    adWaiverGranted: false,
    revenueTotal: 0,
    shipping: { feeIls: 25, minDays: 1, maxDays: 5 },
    wallet: { balance: 0, pendingPayout: 0, reserve: 0 },
  }

  const tempPassword = randomUUID().slice(0, 8)
  const owner = {
    id: randomUUID(),
    storeId: store.id,
    name: parsed.data.ownerName,
    email: ownerEmail,
    idNumber: parsed.data.ownerIdNumber,
    role: "owner",
    passwordHash: hashPassword(tempPassword),
  }

  persist((s) => {
    s.stores.push(store)
    s.merchants.push(owner)
  })

  let welcomeEmail = { status: "skipped" }
  try {
    const delivery = await sendMail({
      to: ownerEmail,
      subject: `ברוכים הבאים למדרום — פרטי כניסה ל${store.name}`,
      body: [
        `שלום ${owner.name},`,
        "",
        `נפתחה עבורך חנות במדרום: ${store.name}`,
        `כתובת כניסה לניהול: /merchant/login`,
        `אימייל: ${ownerEmail}`,
        `סיסמה זמנית: ${tempPassword}`,
        "",
        "מומלץ להחליף את הסיסמה מיד לאחר הכניסה הראשונה.",
        "בהצלחה!",
      ].join("\n"),
      kind: "store-owner-welcome",
    })
    welcomeEmail = { status: delivery?.status || "queued" }
  } catch (error) {
    console.error("[admin] owner welcome email failed:", error.message)
    welcomeEmail = { status: "failed", error: error.message }
  }

  res.status(201).json({
    store,
    ownerLogin: { email: owner.email, temporaryPassword: tempPassword },
    welcomeEmail,
  })
})

router.get("/stores", (req, res) => res.json(getState().stores))

router.patch("/stores/:id/status", (req, res) => {
  const { status } = req.body
  if (!["active", "suspended", "removed"].includes(status)) return res.status(400).json({ error: "סטטוס לא תקין" })
  const state = getState()
  if (!state.stores.some((item) => item.id === req.params.id)) return res.status(404).json({ error: "חנות לא נמצאה" })
  persist((s) => { s.stores.find((item) => item.id === req.params.id).status = status })
  res.json(getState().stores.find((item) => item.id === req.params.id))
})

router.patch("/stores/:id/ad-waiver", (req, res) => {
  const state = getState()
  if (!state.stores.some((item) => item.id === req.params.id)) return res.status(404).json({ error: "חנות לא נמצאה" })
  persist((s) => { s.stores.find((item) => item.id === req.params.id).adWaiverGranted = !!req.body.granted })
  res.json(getState().stores.find((item) => item.id === req.params.id))
})

// Platform has full visibility into every store's revenue, customers, and refunds.
router.get("/analytics", (req, res) => {
  const state = getState()
  const totalRevenue = state.orders.reduce((sum, order) => sum + order.total, 0)
  const totalFees = state.orders.reduce((sum, order) => sum + order.platformFee, 0)
  const byStore = state.stores.map((store) => {
    const storeOrders = state.orders.filter((order) => order.storeId === store.id)
    return { storeId: store.id, name: store.name, orders: storeOrders.length, revenue: storeOrders.reduce((sum, order) => sum + order.total, 0) }
  })
  res.json({ totalRevenue, totalFees, totalOrders: state.orders.length, totalCustomers: state.customers.length, totalVisits: state.visits.length, byStore })
})

router.get("/refunds", (req, res) => res.json(getState().refundRequests.filter((item) => item.status === "pending-platform")))

// מנהל המערכת רואה את כל ה-Master Orders עם כל הזמנות-המשנה שלהם, בין החנויות.
router.get("/orders", (req, res) => {
  const state = getState()
  const masterOrders = state.masterOrders
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((item) => attachStoreOrders(state, item))
  res.json(masterOrders)
})

router.patch("/refunds/:id", (req, res) => {
  const { status } = req.body
  if (!["approved", "denied"].includes(status)) return res.status(400).json({ error: "סטטוס לא תקין" })
  const state = getState()
  const refund = state.refundRequests.find((item) => item.id === req.params.id)
  if (!refund) return res.status(404).json({ error: "בקשת זיכוי לא נמצאה" })
  persist((s) => {
    const target = s.refundRequests.find((item) => item.id === req.params.id)
    target.status = status
    if (status === "approved") {
      // Coverage was insufficient, so this is charged to the store's bound
      // payment method out of band and offset against its next payout.
      const store = s.stores.find((item) => item.id === target.storeId)
      store.wallet.pendingPayout = Math.round((store.wallet.pendingPayout - target.amount) * 100) / 100
    }
  })
  res.json(getState().refundRequests.find((item) => item.id === req.params.id))
})
// ======================================================
// PLATFORM CLOSURES
// שבתות / חגים / סגירות ידניות לפי תאריך ושעה
// ======================================================

router.get("/closures", (req, res) => {
  const closures = Array.isArray(getState().closures)
    ? getState().closures
    : []

  res.json(
    [...closures].sort((a, b) =>
      String(a.startsAt).localeCompare(String(b.startsAt))
    )
  )
})

router.post("/closures", (req, res) => {
  const {
    name,
    startsAt,
    endsAt,
    active = true,
  } = req.body || {}

  if (!name || !startsAt || !endsAt) {
    return res.status(400).json({
      error: "יש להזין שם סגירה, זמן התחלה וזמן סיום",
    })
  }

  if (String(startsAt) >= String(endsAt)) {
    return res.status(400).json({
      error: "זמן הסיום חייב להיות מאוחר מזמן ההתחלה",
    })
  }

  const closure = {
    id: require("crypto").randomUUID(),
    name: String(name).trim(),
    startsAt: String(startsAt),
    endsAt: String(endsAt),
    active: active !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  persist((s) => {
    if (!Array.isArray(s.closures)) {
      s.closures = []
    }

    s.closures.push(closure)
  })

  res.status(201).json(closure)
})

router.patch("/closures/:id", (req, res) => {
  const state = getState()

  const existing = (state.closures || []).find(
    (item) => item.id === req.params.id
  )

  if (!existing) {
    return res.status(404).json({
      error: "הסגירה לא נמצאה",
    })
  }

  const name =
    req.body?.name !== undefined
      ? String(req.body.name).trim()
      : existing.name

  const startsAt =
    req.body?.startsAt !== undefined
      ? String(req.body.startsAt)
      : existing.startsAt

  const endsAt =
    req.body?.endsAt !== undefined
      ? String(req.body.endsAt)
      : existing.endsAt

  const active =
    req.body?.active !== undefined
      ? Boolean(req.body.active)
      : existing.active

  if (!name || !startsAt || !endsAt) {
    return res.status(400).json({
      error: "יש להזין שם סגירה, זמן התחלה וזמן סיום",
    })
  }

  if (startsAt >= endsAt) {
    return res.status(400).json({
      error: "זמן הסיום חייב להיות מאוחר מזמן ההתחלה",
    })
  }

  persist((s) => {
    const target = s.closures.find(
      (item) => item.id === req.params.id
    )

    if (!target) return

    target.name = name
    target.startsAt = startsAt
    target.endsAt = endsAt
    target.active = active
    target.updatedAt = new Date().toISOString()
  })

  res.json(
    getState().closures.find(
      (item) => item.id === req.params.id
    )
  )
})

router.delete("/closures/:id", (req, res) => {
  const exists = (getState().closures || []).some(
    (item) => item.id === req.params.id
  )

  if (!exists) {
    return res.status(404).json({
      error: "הסגירה לא נמצאה",
    })
  }

  persist((s) => {
    s.closures = (s.closures || []).filter(
      (item) => item.id !== req.params.id
    )
  })

  res.status(204).end()
})
module.exports = router
