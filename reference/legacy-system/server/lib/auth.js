// ─────────────────────────────────────────────────────────────
// auth.js — JWT, bcrypt, middleware להרשאות
// ─────────────────────────────────────────────────────────────

const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")

const NODE_ENV = process.env.NODE_ENV || "development"
const JWT_SECRET = process.env.JWT_SECRET || ""

// ── Startup validation ─────────────────────────────────────
if (!JWT_SECRET) {
  if (NODE_ENV === "production") {
    throw new Error("[auth] JWT_SECRET חייב להיות מוגדר ב-production")
  }
  console.warn("[auth] ⚠️  JWT_SECRET לא הוגדר — משתמש ב-secret ברירת מחדל (dev בלבד!)")
}

if (JWT_SECRET && JWT_SECRET.length < 32) {
  if (NODE_ENV === "production") {
    throw new Error("[auth] JWT_SECRET חייב להיות לפחות 32 תווים ב-production")
  }
  console.warn("[auth] ⚠️  JWT_SECRET קצר מ-32 תווים — ממלא ממחולל מקרי")
}

const SECRET = JWT_SECRET || require("crypto").randomBytes(48).toString("hex")
const JWT_ALGORITHM = "HS256"
const TOKEN_TTL = "12h"
const ISSUER = "madarom"

// bcrypt: 12 rounds ב-production (מאוזן בין אבטחה לביצועים)
// 10 rounds ב-dev כדי לקצר זמן הרצת tests
const BCRYPT_ROUNDS = NODE_ENV === "production" ? 12 : 10

// ── Password hashing ───────────────────────────────────────

function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS)
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash)
}

// ── JWT ────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, SECRET, {
    expiresIn: TOKEN_TTL,
    algorithm: JWT_ALGORITHM,
    issuer: ISSUER,
  })
}

/**
 * requireAuth(...roles) — Express middleware
 * מאמת Bearer token ובודק שה-role של המשתמש נמצא ברשימה המותרת.
 * מחזיר 401 אם אין/לא תקין, 403 אם ה-role לא מורשה.
 */
function requireAuth(...allowedRoles) {
  return (req, res, next) => {
    const header = req.headers.authorization || ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : null

    if (!token) {
      return res.status(401).json({ error: "נדרשת התחברות" })
    }

    try {
      const decoded = jwt.verify(token, SECRET, {
        algorithms: [JWT_ALGORITHM],
        issuer: ISSUER,
      })

      if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ error: "אין הרשאה לפעולה זו" })
      }

      req.auth = decoded
      next()
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          error: "פג תוקף ההתחברות, יש להתחבר מחדש",
          code: "TOKEN_EXPIRED",
        })
      }
      if (err.name === "JsonWebTokenError") {
        return res.status(401).json({ error: "טוקן לא תקין, יש להתחבר מחדש" })
      }
      return res.status(401).json({ error: "שגיאת אימות" })
    }
  }
}

/**
 * requireStoreWrite — בדיקת הרשאת כתיבה לחנות
 * רואה חשבון (accountant) מקבל גישת קריאה בלבד; owner/admin יכולים לכתוב.
 */
function requireStoreWrite(req, res, next) {
  if (req.auth?.role !== "owner" && req.auth?.role !== "admin") {
    return res.status(403).json({ error: "גישת רואה חשבון היא לצפייה בלבד" })
  }
  next()
}

/**
 * requireOwnerOrAdmin — פעולות רגישות (כמו ניהול מנהלים) פתוחות רק לבעל
 * העסק או למנהל המערכת, לעולם לא למנהל-חנות (manager).
 */
function requireOwnerOrAdmin(req, res, next) {
  if (req.auth?.role !== "owner" && req.auth?.role !== "admin") {
    return res.status(403).json({ error: "אין הרשאה לפעולה זו" })
  }
  next()
}

/**
 * requirePermission(permission) — owner/admin תמיד מורשים; manager מורשה
 * רק אם ה-permission המבוקש מסומן true בטוקן שלו.
 */
function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.auth?.role

    if (role === "owner" || role === "admin") {
      return next()
    }

    if (role === "manager" && req.auth?.permissions?.[permission]) {
      return next()
    }

    return res.status(403).json({ error: "אין לך הרשאה לפעולה זו" })
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  requireStoreWrite,
  requireOwnerOrAdmin,
  requirePermission,
}
