require("dotenv").config()

const express = require("express")
const cors = require("cors")
const { randomUUID } = require("crypto")

const { getState, persist } = require("./lib/db")
const { hashPassword } = require("./lib/auth")
const { assertPaymentConfiguration } = require("./lib/paymentProvider")

const {
  securityHeaders,
  requestId,
  corsAllowlist,
  apiRateLimit,
  trimBody,
} = require("./lib/security")

const authRoutes = require("./routes/auth")
const adminRoutes = require("./routes/admin")
const merchantRoutes = require("./routes/merchant")
const catalogRoutes = require("./routes/catalog")
const orderRoutes = require("./routes/orders")
const sitemapRoutes = require("./routes/sitemap")


// ======================================================
// CONFIG
// ======================================================

const PORT = Number(process.env.PORT) || 4000

const NODE_ENV =
  process.env.NODE_ENV || "development"

const isDev =
  NODE_ENV !== "production"


// ======================================================
// PRE-FLIGHT
// ======================================================

assertPaymentConfiguration()


// ======================================================
// BOOTSTRAP ADMIN
// ======================================================

function ensureBootstrapAdmin() {
  const state = getState()

  if (state.admins.length > 0) {
    return
  }

  const email =
    process.env.ADMIN_EMAIL

  const password =
    process.env.ADMIN_PASSWORD

  if (
    !email &&
    !isDev
  ) {
    throw new Error(
      "ADMIN_EMAIL חסר במצב production"
    )
  }

  if (
    !password &&
    !isDev
  ) {
    throw new Error(
      "ADMIN_PASSWORD חסר במצב production"
    )
  }

  const resolvedEmail =
    email ||
    "admin@madarom.local"

  const resolvedPassword =
    password ||
    randomUUID().slice(0, 12)

  const existingAdmin = state.admins.find(
    (item) => item.email === resolvedEmail
  )

  if (existingAdmin) {
    if (password) {
      persist((current) => {
        const target = current.admins.find(
          (item) => item.id === existingAdmin.id
        )
        if (target) {
          target.passwordHash = hashPassword(resolvedPassword)
        }
      })
    }
    return
  }

  const admin = {
    id: randomUUID(),

    name:
      "מנהל מערכת",

    email:
      resolvedEmail,

    passwordHash:
      hashPassword(
        resolvedPassword
      ),
  }

  persist((state) => {
    state.admins.push(admin)
  })

  if (isDev && !password) {
    console.log("")
    console.log(
      "======================================"
    )
    console.log(
      "[DEV] נוצר חשבון מנהל מקומי"
    )
    console.log(
      `Email: ${resolvedEmail}`
    )
    console.log(
      `Password: ${resolvedPassword}`
    )
    console.log(
      "======================================"
    )
    console.log("")
  } else {
    console.log(
      `[bootstrap] Admin account ready: ${resolvedEmail}`
    )
  }
}

ensureBootstrapAdmin()


// ======================================================
// EXPRESS
// ======================================================

const app = express()


// ======================================================
// PROXY
// ======================================================

if (!isDev) {
  app.set(
    "trust proxy",
    1
  )
}


// ======================================================
// MIDDLEWARE
// ======================================================

// Request ID
app.use(requestId)

// Security headers
app.use(securityHeaders)


// ======================================================
// CORS
// ======================================================

const corsOptions = isDev
  ? {
      origin: true,

      credentials: true,

      methods: [
        "GET",
        "POST",
        "PATCH",
        "PUT",
        "DELETE",
        "OPTIONS",
      ],

      allowedHeaders: [
        "Content-Type",
        "Authorization",
      ],
    }
  : corsAllowlist(
      "ALLOWED_ORIGINS",
      ""
    )

app.use(
  cors(corsOptions)
)


// ======================================================
// BODY PARSING
// ======================================================

app.use(
  express.json({
    limit: "256kb",
  })
)

app.use(
  express.urlencoded({
    extended: false,
    limit: "256kb",
  })
)


// ======================================================
// INPUT CLEANUP
// ======================================================

app.use(trimBody)


// ======================================================
// RATE LIMIT
// ======================================================

app.use(
  "/api",
  apiRateLimit
)


// ======================================================
// ROUTES
// ======================================================

// Sitemap + robots
app.use(
  "/",
  sitemapRoutes
)

// Authentication
app.use(
  "/api/auth",
  authRoutes
)

// Admin
app.use(
  "/api/admin",
  adminRoutes
)

// Merchant / CRM
app.use(
  "/api/merchant",
  merchantRoutes
)

// Catalog
app.use(
  "/api/catalog",
  catalogRoutes
)

// Orders
app.use(
  "/api/orders",
  orderRoutes
)


// ======================================================
// HEALTH
// ======================================================

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,

      env:
        NODE_ENV,

      port:
        PORT,

      ts:
        new Date().toISOString(),

      requestId:
        req.requestId,
    })
  }
)


// ======================================================
// ROOT DEV ROUTE
// ======================================================

app.get(
  "/api",
  (req, res) => {
    res.json({
      ok: true,

      name:
        "Madarom API",

      environment:
        NODE_ENV,

      health:
        "/api/health",
    })
  }
)


// ======================================================
// 404
// ======================================================

app.use(
  (req, res) => {
    res.status(404).json({
      error:
        `נתיב לא נמצא: ${req.method} ${req.path}`,
    })
  }
)


// ======================================================
// ERROR HANDLER
// ======================================================

// eslint-disable-next-line no-unused-vars
app.use(
  (err, req, res, next) => {
    const id =
      req.requestId ||
      "unknown"

    const status =
      err.status ||
      err.statusCode ||
      500

    if (isDev) {
      console.error(
        `[error] [${id}]`,
        err
      )
    } else {
      console.error(
        `[error] [${id}] ${status} ${err.message}`
      )
    }

    res
      .status(status)
      .json({
        error:
          status === 500
            ? "שגיאת שרת פנימית"
            : err.message ||
              "שגיאה לא ידועה",

        requestId:
          id,

        ...(
          isDev &&
          status === 500
            ? {
                stack:
                  err.stack,
              }
            : {}
        ),
      })
  }
)


// ======================================================
// START SERVER
// ======================================================

const server = app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("")
    console.log(
      "======================================"
    )

    console.log(
      `[מדרום] API running`
    )

    console.log(
      `Local: http://localhost:${PORT}`
    )

    console.log(
      `Health: http://localhost:${PORT}/api/health`
    )

    console.log(
      `Environment: ${NODE_ENV}`
    )

    console.log(
      "======================================"
    )
    console.log("")
  }
)


// ======================================================
// SERVER ERRORS
// ======================================================

server.on(
  "error",
  (error) => {
    if (
      error.code ===
      "EADDRINUSE"
    ) {
      console.error(
        `[SERVER] פורט ${PORT} כבר נמצא בשימוש`
      )
    } else {
      console.error(
        "[SERVER ERROR]",
        error
      )
    }

    process.exit(1)
  }
)


// ======================================================
// PROCESS ERRORS
// ======================================================

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "[UNCAUGHT EXCEPTION]",
      error
    )
  }
)

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "[UNHANDLED REJECTION]",
      reason
    )
  }
)


// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

function shutdown(signal) {
  console.log(
    `[SERVER] ${signal} received`
  )

  server.close(() => {
    console.log(
      "[SERVER] stopped"
    )

    process.exit(0)
  })
}

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
)

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
)