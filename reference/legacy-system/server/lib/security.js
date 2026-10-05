// ─────────────────────────────────────────────────────────────
// security.js — Security middleware עבור מדרום API
//
// מכסה: Rate limiting, Security headers, CSP, HSTS, CORS, Request ID
// ─────────────────────────────────────────────────────────────

const crypto = require("crypto")

const isDev = process.env.NODE_ENV !== "production"

// ══════════════════════════════════════════════════════════════
// Rate Limiter — Sliding window, in-memory
// להפצה מרובת-תהליכים: החלף ב-Redis (upstash-redis / ioredis)
// ══════════════════════════════════════════════════════════════

const buckets = new Map()

function rateLimit({ windowMs, max, keyFn, message }) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip
    const now = Date.now()
    const bucket = buckets.get(key) || []
    const recent = bucket.filter((ts) => now - ts < windowMs)

    if (recent.length >= max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000))
      return res.status(429).json({
        error: message || "יותר מדי ניסיונות, יש לנסות שוב בעוד כמה דקות",
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      })
    }

    recent.push(now)
    buckets.set(key, recent)
    next()
  }
}

// ניקוי buckets ישנים כל 5 דקות כדי למנוע דליפת זיכרון
const CLEANUP_INTERVAL = 5 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  const MAX_WINDOW = 15 * 60 * 1000
  for (const [key, bucket] of buckets) {
    const fresh = bucket.filter((ts) => now - ts < MAX_WINDOW)
    if (fresh.length === 0) buckets.delete(key)
    else buckets.set(key, fresh)
  }
}, CLEANUP_INTERVAL).unref() // unref — לא מונע סגירת Node

// Rate limits מוגדרים מראש
const loginRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 דקות
  max: 10,
  keyFn: (req) => `login:${req.ip}:${(req.body?.email || "").toLowerCase()}`,
  message: "יותר מדי ניסיונות התחברות — המתן 10 דקות",
})

const codeRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyFn: (req) => {
    const identity = String(
      req.body?.email || req.body?.customerId || req.body?.phone || ""
    ).toLowerCase()
    return `code:${req.ip}:${identity}`
  },
  message: "יותר מדי ניסיונות קוד — המתן 10 דקות",
})

const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 דקה
  max: 120,
  keyFn: (req) => `api:${req.ip}`,
  message: "עומס בקשות — המתן דקה ונסה שוב",
})

// ══════════════════════════════════════════════════════════════
// Security Headers
// ══════════════════════════════════════════════════════════════

// Content Security Policy — קשיחה ב-production, Report-Only ב-dev
function buildCSP() {
  const googleDomains = "https://accounts.google.com https://apis.google.com https://www.googleapis.com"
  const connectExtra = isDev ? "http://localhost:* http://127.0.0.1:*" : ""

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${googleDomains}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: blob: https:`,
    `connect-src 'self' ${googleDomains} ${connectExtra}`.trim(),
    `frame-src 'self' ${googleDomains}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ]

  return directives.join("; ")
}

function securityHeaders(req, res, next) {
  // הסר טביעת אצבע של framework
  res.removeHeader("X-Powered-By")

  // Headers בסיסיים — תמיד
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Cross-Origin-Resource-Policy", "same-site")
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(), usb=()")

  // HSTS — רק ב-production עם HTTPS
  if (!isDev) {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
  }

  // CSP — קשיח ב-production, report-only ב-dev
  const csp = buildCSP()
  if (isDev) {
    res.setHeader("Content-Security-Policy-Report-Only", csp)
  } else {
    res.setHeader("Content-Security-Policy", csp)
  }

  next()
}

// ══════════════════════════════════════════════════════════════
// Request ID — לזיהוי בקשות ב-logs ו-error responses
// ══════════════════════════════════════════════════════════════

function requestId(req, res, next) {
  const id = crypto.randomUUID()
  req.requestId = id
  res.setHeader("X-Request-Id", id)
  next()
}

// ══════════════════════════════════════════════════════════════
// CORS Allowlist — רק origins מאושרים ב-production
// ══════════════════════════════════════════════════════════════

function corsAllowlist(envVar, fallback) {
  const raw = process.env[envVar] || fallback
  const allowed = new Set(
    raw.split(",").map((item) => item.trim()).filter(Boolean)
  )

  return {
    origin(origin, callback) {
      // בקשות ללא origin (Postman, server-to-server) — מותרות
      if (!origin) return callback(null, true)
      if (allowed.has(origin)) return callback(null, true)
      callback(new Error(`Origin לא מורשה: ${origin}`))
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
    maxAge: 86400, // preflight cache 24 שעות
  }
}

// ══════════════════════════════════════════════════════════════
// Input Sanitization helpers
// ══════════════════════════════════════════════════════════════

// חיתוך whitespace מסביב לשדות string ב-req.body
function trimBody(req, res, next) {
  if (req.body && typeof req.body === "object") {
    for (const [key, val] of Object.entries(req.body)) {
      if (typeof val === "string") req.body[key] = val.trim()
    }
  }
  next()
}

// ══════════════════════════════════════════════════════════════

function newId() {
  return crypto.randomUUID()
}

module.exports = {
  rateLimit,
  loginRateLimit,
  codeRateLimit,
  apiRateLimit,
  securityHeaders,
  requestId,
  corsAllowlist,
  trimBody,
  newId,
}
