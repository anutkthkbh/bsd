// ─────────────────────────────────────────────────────────────
// client.js — API client עם ניהול טוקנים ו-error handling
// ─────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api"

// ── Token storage ──────────────────────────────────────────

function getToken(scope) {
  return sessionStorage.getItem(`madarom_token_${scope}`)
}

function setToken(scope, token) {
  if (token) sessionStorage.setItem(`madarom_token_${scope}`, token)
  else sessionStorage.removeItem(`madarom_token_${scope}`)
}

function getProfile(scope) {
  const raw = sessionStorage.getItem(`madarom_profile_${scope}`)
  return raw ? JSON.parse(raw) : null
}

function setProfile(scope, profile) {
  if (profile) sessionStorage.setItem(`madarom_profile_${scope}`, JSON.stringify(profile))
  else sessionStorage.removeItem(`madarom_profile_${scope}`)
}

// ── JWT expiry check (client-side pre-flight) ───────────────
// מונע שליחת בקשות עם טוקן שפג תוקפו — ה-JWT מפוענח בלי אימות (חתימה נבדקת בשרת)
function isTokenExpired(scope) {
  const token = getToken(scope)
  if (!token) return true
  try {
    const payload = JSON.parse(atob(token.split(".")[1]))
    return payload.exp * 1000 < Date.now()
  } catch {
    return true
  }
}

// ── Request ────────────────────────────────────────────────

class ApiError extends Error {
  constructor(message, status, code, details = {}) {
    super(message)
    this.status = status
    this.code = code
    Object.assign(this, details)
  }
}

async function request(path, { method = "GET", body, scope, auth } = {}) {
  const headers = { "Content-Type": "application/json" }

  if (auth && scope) {
    if (isTokenExpired(scope)) {
      // מנקה את הטוקן שפג תוקפו ומחזיר שגיאה ידידותית
      setToken(scope, null)
      setProfile(scope, null)
      throw new ApiError("פג תוקף ההתחברות — יש להתחבר מחדש", 401, "TOKEN_EXPIRED")
    }
    const token = getToken(scope)
    if (token) headers["Authorization"] = `Bearer ${token}`
  }

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "omit", // טוקנים עוברים ב-Authorization header, לא ב-cookie
    })
  } catch (networkErr) {
    throw new ApiError("אין חיבור לשרת — בדוק/י חיבור לאינטרנט", 0, "NETWORK_ERROR")
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null)

  if (!res.ok) {
    const message = data?.error || `שגיאת שרת (${res.status})`
    const code = data?.code || String(res.status)
    throw new ApiError(message, res.status, code, data || {})
  }

  return data
}

// ── Public API ─────────────────────────────────────────────

export const api = {
  get:    (path, opts)       => request(path, { ...opts, method: "GET" }),
  post:   (path, body, opts) => request(path, { ...opts, method: "POST",   body }),
  patch:  (path, body, opts) => request(path, { ...opts, method: "PATCH",  body }),
  delete: (path, opts)       => request(path, { ...opts, method: "DELETE" }),
}

export const tokens = { get: getToken, set: setToken, getProfile, setProfile, isExpired: isTokenExpired }
