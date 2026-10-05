// ─────────────────────────────────────────────────────────────
// consent.js — שמירת בחירת המשתמש/ת לגבי עוגיות ומעקב
// ─────────────────────────────────────────────────────────────

const CONSENT_KEY = "madarom_cookie_consent"
const CONSENT_DATE_KEY = "madarom_cookie_consent_at"

export function getConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY)
  } catch {
    return null
  }
}

export function setConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value)
    localStorage.setItem(CONSENT_DATE_KEY, new Date().toISOString())
  } catch {
    // localStorage חסום (למשל מצב פרטי) — ממשיכים בלי לשמור העדפה
  }
}

export function hasAcceptedTracking() {
  return getConsent() === "accepted"
}
