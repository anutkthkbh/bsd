const { Router } = require("express")
const { randomUUID } = require("crypto")
const { z } = require("zod")

const { getState, persist } = require("../lib/db")
const { hashPassword, verifyPassword, signToken, requireAuth } = require("../lib/auth")
const { issueCode, issueSmsCode, verifyCode } = require("../lib/codes")
const { normalizePhone } = require("../lib/sms")
const { getGoogleClientId, verifyGoogleCredential } = require("../lib/googleAuth")
const { codeRateLimit, loginRateLimit } = require("../lib/security")
const { getMissingCustomerFields } = require("../lib/customerValidation")

const router = Router()
// ======================================================
// LOCAL DEVELOPMENT AUTH
// ======================================================

function isLocalDev(req) {
  if (process.env.NODE_ENV === "production") {
    return false
  }

  if (process.env.DEV_AUTH_BYPASS !== "true") {
    return false
  }

  const address =
    req.socket?.remoteAddress || ""

  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  )
}

function isDevCode(req, code) {
  return (
    isLocalDev(req) &&
    String(code) === "0000"
  )
}

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(9),
  phone2: z.string().optional(),
  address: z.string().min(2),
  city: z.string().min(2),
  zip: z.string().min(4),
  // הרשמה — אימות באימייל בלבד (אין SMS בהרשמה)
})

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase()
}

function findAccountByEmail(state, email) {
  const admin = state.admins.find(
    (item) => normalizeEmail(item.email) === email
  )

  if (admin) {
    return {
      type: "admin",
      email: admin.email,
      redirectTo: "/admin/login",
    }
  }

  const merchant = state.merchants.find(
    (item) => normalizeEmail(item.email) === email
  )

  if (merchant) {
    return {
      type: "merchant",
      email: merchant.email,
      redirectTo: "/merchant/login",
    }
  }

  const customer = state.customers.find(
    (item) => normalizeEmail(item.email) === email
  )

  return customer
    ? { type: "customer", email: customer.email, customer }
    : null
}

function pickDevCode(record) {
  return process.env.NODE_ENV === "production" ? undefined : record?.devCode
}

async function sendCustomerVerification(customer) {
  const record = await issueCode(
    getState(),
    normalizeEmail(customer.email),
    "customer-verify"
  )
  return { method: "email", devCode: pickDevCode(record) }
}

async function sendCustomerLoginCode(customer, channel = "email") {
  if (channel === "sms") {
    const phone = normalizePhone(customer.phone)
    if (!phone) {
      throw new Error("אין מספר טלפון רשום בחשבון לשליחת SMS")
    }
    const record = await issueSmsCode(getState(), phone, "customer-login")
    return { method: "sms", devCode: pickDevCode(record) }
  }

  const record = await issueCode(
    getState(),
    normalizeEmail(customer.email),
    "customer-login"
  )
  return { method: "email", devCode: pickDevCode(record) }
}


// ======================================================
// CUSTOMER SIGNUP
// ======================================================

router.post("/customer/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({
      error: "פרטים חסרים או לא תקינים",
      details: parsed.error.issues,
    })
  }

  const email = normalizeEmail(parsed.data.email)
  const phone = normalizePhone(parsed.data.phone)
  const phone2 = parsed.data.phone2
    ? normalizePhone(parsed.data.phone2)
    : ""

  const existingCustomer = getState().customers.find(
    (item) => normalizeEmail(item.email) === email
  )

  // חשבון קיים ומאומת:
  // במקום 409 שולחים קוד התחברות באימייל
  if (existingCustomer?.verified) {
    try {
      const delivery = await sendCustomerLoginCode(existingCustomer, "email")

      return res.json({
        flow: "login",
        existingAccount: true,
        customerId: existingCustomer.id,
        verificationMethod: delivery.method,
        message: "מצאנו חשבון קיים. שלחנו קוד התחברות לאימייל.",
        devCode: delivery.devCode,
      })
    } catch (error) {
      console.error("[auth] login code delivery failed:", error.message)
      return res.status(502).json({ error: "לא הצלחנו לשלוח את קוד ההתחברות" })
    }
  }

  // חשבון קיים אך עדיין לא אומת:
  // מעדכנים את הפרטים ושולחים קוד אימות לאימייל
  if (existingCustomer) {
    persist((current) => {
      const customer = current.customers.find(
        (item) => item.id === existingCustomer.id
      )

      if (!customer) return

      customer.name = parsed.data.name.trim()
      customer.email = email
      customer.phone = phone
      customer.phone2 = phone2
      customer.address = parsed.data.address.trim()
      customer.city = parsed.data.city.trim()
      customer.zip = parsed.data.zip.trim()
      customer.verificationMethod = "email"
    })

    const refreshedCustomer = getState().customers.find(
      (item) => item.id === existingCustomer.id
    )

    try {
      const delivery = await sendCustomerVerification(refreshedCustomer)

      return res.json({
        flow: "verify",
        existingAccount: true,
        customerId: existingCustomer.id,
        verificationMethod: delivery.method,
        message: "החשבון עדיין לא אומת. שלחנו קוד חדש לאימייל.",
        devCode: delivery.devCode,
      })
    } catch (error) {
      console.error("[auth] resend verification failed:", error.message)

      return res.status(502).json({
        error: "לא הצלחנו לשלוח את קוד האימות",
      })
    }
  }

  // חשבון חדש — אימות באימייל בלבד
  const customer = {
    id: randomUUID(),
    name: parsed.data.name.trim(),
    email,
    phone,
    phone2,
    address: parsed.data.address.trim(),
    city: parsed.data.city.trim(),
    zip: parsed.data.zip.trim(),

    verificationMethod: "email",

    verified: false,
    verifiedVia: null,
    verifiedAt: null,

    purchaseCount: 0,
    createdAt: new Date().toISOString(),
  }

  persist((current) => {
    current.customers.push(customer)
  })

  try {
    const delivery = await sendCustomerVerification(customer)

    return res.json({
      flow: "verify",
      existingAccount: false,
      customerId: customer.id,
      verificationMethod: delivery.method,
      message: "נשלח קוד אימות לאימייל",
      devCode: delivery.devCode,
    })
  } catch (error) {
    console.error("[auth] verification delivery failed:", error.message)

    persist((current) => {
      current.customers = current.customers.filter(
        (item) => item.id !== customer.id
      )

      current.authCodes = current.authCodes.filter(
        (item) =>
          !(
            item.purpose === "customer-verify" &&
            item.target === customer.email
          )
      )
    })

    return res.status(502).json({
      error: "שליחת קוד האימות נכשלה",
    })
  }
})


// ======================================================
// CUSTOMER VERIFY
// ======================================================

router.post("/customer/verify", codeRateLimit, (req, res) => {
  const { customerId, code } = req.body || {}

  if (!customerId || !code) {
    return res.status(400).json({
      error: "חסר מזהה לקוח או קוד אימות",
    })
  }

  const state = getState()

  const customer = state.customers.find(
    (item) => item.id === customerId
  )

  if (!customer) {
    return res.status(404).json({
      error: "לקוח לא נמצא",
    })
  }

  if (customer.verified) {
    const token = signToken({
      role: "customer",
      id: customer.id,
      name: customer.name,
    })

    return res.json({
      token,
      alreadyVerified: true,

      user: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        verified: true,
        verifiedVia: customer.verifiedVia,
      },
    })
  }

  // הרשמה — אימות באימייל בלבד
  const valid = isDevCode(req, code) || verifyCode(
    state,
    normalizeEmail(customer.email),
    "customer-verify",
    code
  )

  if (!valid) {
    return res.status(400).json({
      error: "קוד שגוי או פג תוקף",
    })
  }

  persist((current) => {
    const currentCustomer = current.customers.find(
      (item) => item.id === customer.id
    )

    if (!currentCustomer) return

    currentCustomer.verified = true
    currentCustomer.verifiedVia = "email"
    currentCustomer.verifiedAt = new Date().toISOString()
  })

  const token = signToken({
    role: "customer",
    id: customer.id,
    name: customer.name,
  })

  return res.json({
    token,

    user: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      verified: true,
      verifiedVia: "email",
    },
  })
})


// ======================================================
// CUSTOMER RESEND VERIFICATION
// ======================================================

router.post("/customer/resend-verification", async (req, res) => {
  const { customerId } = req.body || {}

  if (!customerId) {
    return res.status(400).json({
      error: "חסר מזהה לקוח",
    })
  }

  const customer = getState().customers.find(
    (item) => item.id === customerId
  )

  if (!customer) {
    return res.status(404).json({
      error: "לקוח לא נמצא",
    })
  }

  // אם החשבון כבר אומת בינתיים,
  // עוברים אוטומטית לקוד התחברות
  if (customer.verified) {
    try {
      const delivery = await sendCustomerLoginCode(customer, "email")

      return res.json({
        flow: "login",
        customerId: customer.id,
        verificationMethod: delivery.method,
        message: "החשבון כבר מאומת. שלחנו קוד התחברות לאימייל.",
        devCode: delivery.devCode,
      })
    } catch (error) {
      console.error("[auth] login code delivery failed:", error.message)
      return res.status(502).json({ error: "לא הצלחנו לשלוח את קוד ההתחברות" })
    }
  }

  try {
    const delivery = await sendCustomerVerification(customer)

    return res.json({
      flow: "verify",
      customerId: customer.id,
      verificationMethod: delivery.method,
      message: "נשלח קוד חדש לאימייל",
      devCode: delivery.devCode,
    })
  } catch (error) {
    console.error("[auth] resend verification failed:", error.message)

    return res.status(502).json({
      error: "שליחת הקוד נכשלה",
    })
  }
})


// ======================================================
// ACCOUNT TYPE
// ======================================================

router.post("/account-type", loginRateLimit, (req, res) => {
  const email = normalizeEmail(req.body?.email)

  if (!email) {
    return res.status(400).json({ error: "יש להזין אימייל" })
  }

  const account = findAccountByEmail(getState(), email)

  if (!account) {
    return res.status(404).json({ error: "לא נמצא חשבון עם אימייל זה" })
  }

  return res.json({
    type: account.type,
    email: account.email,
    redirectTo: account.redirectTo,
  })
})


// ======================================================
// CUSTOMER REQUEST LOGIN CODE
// ======================================================

router.post("/customer/request-code", async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const channel = req.body?.channel === "sms" ? "sms" : "email"

  if (!email) {
    return res.status(400).json({
      error: "יש להזין אימייל",
    })
  }

  const state = getState()

  const account = findAccountByEmail(state, email)

  if (!account) {
    return res.status(404).json({ error: "לא נמצא חשבון עם אימייל זה" })
  }

  if (account.type !== "customer") {
    return res.json({
      flow: account.type === "admin" ? "admin-password" : "merchant-password",
      email: account.email,
      redirectTo: account.redirectTo,
      message: account.type === "admin"
        ? "אימייל זה שייך למנהל מערכת. מועברים לדף הניהול."
        : "אימייל זה שייך לחשבון עסקי. מועברים לדף הניהול.",
    })
  }

  const customer = account.customer

  // חשבון לא מאומת — אימות הרשמה תמיד באימייל (אין SMS בהרשמה)
  if (!customer.verified) {
    try {
      const delivery = await sendCustomerVerification(customer)

      return res.json({
        flow: "verify",
        customerId: customer.id,
        verificationMethod: delivery.method,
        message: "החשבון עדיין לא אומת. שלחנו קוד אימות לאימייל.",
        devCode: delivery.devCode,
      })
    } catch (error) {
      console.error("[auth] verification resend failed:", error.message)

      return res.status(502).json({
        error: "לא הצלחנו לשלוח את קוד האימות",
      })
    }
  }

  // חשבון מאומת — קוד התחברות במייל או ב-SMS לפי בחירת המשתמש
  try {
    const delivery = await sendCustomerLoginCode(customer, channel)

    return res.json({
      flow: "login",
      customerId: customer.id,
      verificationMethod: delivery.method,
      message:
        delivery.method === "sms"
          ? "קוד התחברות נשלח ב-SMS"
          : "קוד התחברות נשלח לאימייל",
      devCode: delivery.devCode,
    })
  } catch (error) {
    console.error("[auth] login code delivery failed:", error.message)
    return res.status(502).json({
      error: error.message || "לא הצלחנו לשלוח את קוד ההתחברות",
    })
  }
})


// ======================================================
// CUSTOMER LOGIN
// ======================================================

router.post("/customer/login", codeRateLimit, (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const { code } = req.body || {}

  if (!email || !code) {
    return res.status(400).json({
      error: "יש להזין אימייל וקוד אימות",
    })
  }

  const state = getState()

  const customer = state.customers.find(
    (item) => normalizeEmail(item.email) === email
  )

  if (!customer) {
    return res.status(404).json({
      error: "לא נמצא חשבון עם אימייל זה",
    })
  }

  if (!customer.verified) {
    return res.status(403).json({
      error: "החשבון עדיין לא אומת. יש לשלוח קוד אימות מחדש.",
    })
  }

  const channel = req.body?.channel === "sms" ? "sms" : "email"
  const loginTarget =
    channel === "sms"
      ? normalizePhone(customer.phone)
      : normalizeEmail(customer.email)

  if (!loginTarget) {
    return res.status(400).json({
      error: channel === "sms"
        ? "אין מספר טלפון רשום בחשבון"
        : "חסר אימייל בחשבון",
    })
  }

  const valid = isDevCode(req, code) || verifyCode(
    state,
    loginTarget,
    "customer-login",
    code
  )

  if (!valid) {
    return res.status(400).json({
      error: "קוד שגוי או פג תוקף",
    })
  }

  const token = signToken({
    role: "customer",
    id: customer.id,
    name: customer.name,
  })

  return res.json({
    token,

    user: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    },
  })
})


// ======================================================
// CUSTOMER PROFILE (האזור האישי)
// ======================================================

const profileUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(9).optional(),
  phone2: z.string().optional(),
  address: z.string().min(2).optional(),
  city: z.string().min(2).optional(),
  zip: z.string().min(4).optional(),
})

function serializeCustomerProfile(customer) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    phone2: customer.phone2 || "",
    address: customer.address || "",
    city: customer.city || "",
    zip: customer.zip || "",
    verified: customer.verified,
    verifiedVia: customer.verifiedVia,
    authProvider: customer.authProvider || "email",
    createdAt: customer.createdAt,
  }
}

router.get("/customer/profile", requireAuth("customer"), (req, res) => {
  const customer = getState().customers.find((item) => item.id === req.auth.id)

  if (!customer) {
    return res.status(404).json({ error: "לקוח לא נמצא" })
  }

  return res.json(serializeCustomerProfile(customer))
})

router.patch("/customer/profile", requireAuth("customer"), (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({
      error: "פרטים לא תקינים",
      details: parsed.error.issues,
    })
  }

  const customer = getState().customers.find((item) => item.id === req.auth.id)

  if (!customer) {
    return res.status(404).json({ error: "לקוח לא נמצא" })
  }

  persist((current) => {
    const target = current.customers.find((item) => item.id === customer.id)
    if (!target) return

    if (parsed.data.name !== undefined) target.name = parsed.data.name.trim()
    if (parsed.data.phone !== undefined) target.phone = normalizePhone(parsed.data.phone)
    if (parsed.data.phone2 !== undefined) {
      target.phone2 = parsed.data.phone2 ? normalizePhone(parsed.data.phone2) : ""
    }
    if (parsed.data.address !== undefined) target.address = parsed.data.address.trim()
    if (parsed.data.city !== undefined) target.city = parsed.data.city.trim()
    if (parsed.data.zip !== undefined) target.zip = parsed.data.zip.trim()
  })

  const updated = getState().customers.find((item) => item.id === customer.id)

  return res.json(serializeCustomerProfile(updated))
})


// בדיקת מוכנות לתשלום: אותה פונקציה המשמשת גם את /checkout/prepare בשרת,
// כדי שהלקוח יוכל להשלים פרטים חסרים לפני שהוא מגיע למסך הסליקה בכלל.
router.get("/customer/checkout-readiness", requireAuth("customer"), (req, res) => {
  const customer = getState().customers.find((item) => item.id === req.auth.id)

  if (!customer) {
    return res.status(404).json({ error: "לקוח לא נמצא" })
  }

  const missingFields = getMissingCustomerFields(customer)

  return res.json({
    ready: missingFields.length === 0,
    missingFields,
    customer: serializeCustomerProfile(customer),
  })
})


router.get("/public-config", (req, res) => {
  return res.json({ googleClientId: getGoogleClientId() })
})


// ======================================================
// GOOGLE CUSTOMER LOGIN
// ======================================================

router.post("/customer/google", async (req, res) => {
  if (!req.body?.credential) {
    return res.status(400).json({
      error: "חסר אישור התחברות מ-Google",
    })
  }

  let profile

  try {
    profile = await verifyGoogleCredential(
      req.body.credential
    )
  } catch (error) {
    return res.status(401).json({
      error:
        error.message ||
        "אימות Google נכשל",
    })
  }

  const email = normalizeEmail(profile.email)

  const account = findAccountByEmail(getState(), email)

  if (account && account.type !== "customer") {
    return res.status(409).json({
      error: account.type === "admin"
        ? "חשבון Google זה שייך למנהל מערכת. מועברים לדף הניהול."
        : "חשבון Google זה שייך לחשבון עסקי. מועברים לדף הניהול.",
      code: "MANAGEMENT_ACCOUNT",
      email: account.email,
      redirectTo: account.redirectTo,
    })
  }

  let customer = account?.customer || null

  // אם החשבון כבר קיים,
  // Google מאמת את אותו החשבון
  if (customer) {
    if (!customer.verified) {
      persist((current) => {
        const currentCustomer =
          current.customers.find(
            (item) => item.id === customer.id
          )

        if (!currentCustomer) return

        currentCustomer.verified = true
        currentCustomer.verifiedVia = "google"
        currentCustomer.verifiedAt = new Date().toISOString()
        currentCustomer.authProvider = "google"
      })
    }
  } else {
    // חשבון חדש דרך Google
    customer = {
      id: randomUUID(),
      name:
        profile.name ||
        profile.email,

      email,

      phone: "",
      phone2: "",

      address: "",
      city: "",
      zip: "",

      verificationMethod: "google",

      verified: true,
      verifiedVia: "google",
      verifiedAt: new Date().toISOString(),

      authProvider: "google",

      purchaseCount: 0,

      createdAt: new Date().toISOString(),
    }

    persist((current) => {
      current.customers.push(customer)
    })
  }

  customer =
    getState().customers.find(
      (item) => item.id === customer.id
    ) || customer

  const token = signToken({
    role: "customer",
    id: customer.id,
    name: customer.name,
  })

  return res.json({
    token,

    user: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      verified: true,
      verifiedVia: customer.verifiedVia,
    },
  })
})


// ======================================================
// ADMIN LOGIN
// ======================================================

router.post("/admin/login", loginRateLimit, (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const { password } = req.body || {}

  const admin = getState().admins.find(
    (item) => normalizeEmail(item.email) === email
  )

  if (
    !admin ||
    !verifyPassword(
      password,
      admin.passwordHash
    )
  ) {
    return res.status(401).json({
      error: "פרטי התחברות שגויים",
    })
  }

  const token = signToken({
    role: "admin",
    id: admin.id,
    name: admin.name,
  })

  return res.json({
    token,

    user: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: "admin",
    },
  })
})


// ======================================================
// MERCHANT LOGIN
// ======================================================

router.post("/merchant/login", loginRateLimit, (req, res) => {
  const { email, password } = req.body || {}

  const state = getState()

  const normalizedEmail =
    normalizeEmail(email)

  const merchant = state.merchants.find(
    (item) =>
      normalizeEmail(item.email) ===
      normalizedEmail
  )

  if (
    !merchant ||
    !verifyPassword(
      password,
      merchant.passwordHash
    )
  ) {
    return res.status(401).json({
      error: "פרטי התחברות שגויים",
    })
  }

  // מנהלים (role: manager) חייבים לאמת את האימייל שלהם בקוד לפני כניסה ראשונה
  if (merchant.role === "manager" && !merchant.verified) {
    return res.status(403).json({
      error: "יש לאמת את כתובת האימייל באמצעות הקוד שנשלח לפני ההתחברות",
      code: "MANAGER_EMAIL_NOT_VERIFIED",
    })
  }

  const store = state.stores.find(
    (item) =>
      item.id === merchant.storeId
  )

  if (
    !store ||
    store.status === "removed"
  ) {
    return res.status(403).json({
      error: "החנות אינה פעילה במערכת",
    })
  }

  const token = signToken({
    role: merchant.role,
    id: merchant.id,

    storeId:
      store.id,

    storeSlug:
      store.slug,

    name:
      merchant.name,

    permissions:
      merchant.role === "manager"
        ? merchant.permissions || {}
        : undefined,
  })

  return res.json({
    token,

    user: {
      id: merchant.id,
      name: merchant.name,
      role: merchant.role,

      storeSlug:
        store.slug,

      storeName:
        store.name,

      permissions:
        merchant.role === "manager"
          ? merchant.permissions || {}
          : undefined,
    },
  })
})


// ======================================================
// MANAGER EMAIL VERIFICATION
// ======================================================

router.post("/merchant/verify-email", codeRateLimit, (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const { code } = req.body || {}

  if (!email || !code) {
    return res.status(400).json({
      error: "יש להזין אימייל וקוד אימות",
    })
  }

  const state = getState()

  const merchant = state.merchants.find(
    (item) => normalizeEmail(item.email) === email && item.role === "manager"
  )

  if (!merchant) {
    return res.status(404).json({
      error: "לא נמצא חשבון מנהל עם אימייל זה",
    })
  }

  const valid = isDevCode(req, code) || verifyCode(
    state,
    email,
    "manager-verify",
    code
  )

  if (!valid) {
    return res.status(400).json({
      error: "קוד שגוי או פג תוקף",
    })
  }

  persist((current) => {
    const target = current.merchants.find((item) => item.id === merchant.id)
    if (target) target.verified = true
  })

  return res.json({
    message: "האימייל אומת בהצלחה, ניתן להתחבר כעת",
  })
})

router.post("/merchant/resend-verification", codeRateLimit, async (req, res) => {
  const email = normalizeEmail(req.body?.email)

  if (!email) {
    return res.status(400).json({
      error: "יש להזין אימייל",
    })
  }

  const state = getState()

  const merchant = state.merchants.find(
    (item) => normalizeEmail(item.email) === email && item.role === "manager"
  )

  if (!merchant) {
    return res.status(404).json({
      error: "לא נמצא חשבון מנהל עם אימייל זה",
    })
  }

  if (merchant.verified) {
    return res.json({ message: "האימייל כבר מאומת, ניתן להתחבר" })
  }

  try {
    const record = await issueCode(state, email, "manager-verify")
    return res.json({
      message: "נשלח קוד אימות חדש לאימייל",
      devCode: pickDevCode(record),
    })
  } catch (error) {
    console.error("[auth] manager verify resend failed:", error.message)
    return res.status(502).json({ error: "שליחת הקוד נכשלה" })
  }
})


// ======================================================
// MERCHANT PASSWORD RECOVERY
// ======================================================

router.post("/merchant/forgot", codeRateLimit, async (req, res) => {
  const email =
    normalizeEmail(req.body?.email)

  if (!email) {
    return res.status(400).json({
      error: "יש להזין אימייל",
    })
  }

  const merchant =
    getState().merchants.find(
      (item) =>
        normalizeEmail(item.email) ===
        email
    )

  if (!merchant) {
    return res.status(404).json({
      error: "לא נמצא חשבון עם אימייל זה",
    })
  }

  try {
    const record = await issueCode(
      getState(),
      normalizeEmail(merchant.email),
      "merchant-reset"
    )

    return res.json({
      message: "קוד איפוס נשלח לאימייל הרשום",
      devCode: pickDevCode(record),
    })
  } catch (error) {
    console.error("[auth] merchant reset code failed:", error.message)
    return res.status(502).json({ error: "שליחת קוד האיפוס נכשלה" })
  }
})


// ======================================================
// MERCHANT PASSWORD RESET
// ======================================================

router.post("/merchant/reset", codeRateLimit, (req, res) => {
  const email =
    normalizeEmail(req.body?.email)

  const {
    code,
    newPassword,
  } = req.body || {}

  if (!email || !code) {
    return res.status(400).json({
      error: "יש להזין אימייל וקוד אימות",
    })
  }

  if (
    !newPassword ||
    newPassword.length < 8
  ) {
    return res.status(400).json({
      error:
        "הסיסמה החדשה חייבת להכיל לפחות 8 תווים",
    })
  }

  const state = getState()

  const merchant =
    state.merchants.find(
      (item) =>
        normalizeEmail(item.email) ===
        email
    )

  if (!merchant) {
    return res.status(404).json({
      error: "משתמש לא נמצא",
    })
  }

  const valid = isDevCode(req, code) || verifyCode(
    state,
    normalizeEmail(merchant.email),
    "merchant-reset",
    code
  )

  if (!valid) {
    return res.status(400).json({
      error: "קוד שגוי או פג תוקף",
    })
  }

  persist((current) => {
    const currentMerchant =
      current.merchants.find(
        (item) =>
          item.id === merchant.id
      )

    if (!currentMerchant) return

    currentMerchant.passwordHash =
      hashPassword(newPassword)
  })

  return res.json({
    message: "הסיסמה עודכנה בהצלחה",
  })
})


module.exports = router