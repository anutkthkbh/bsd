// ─────────────────────────────────────────────────────────────
// tracking.js — מעקב עמודים מינימלי, פעיל רק לאחר הסכמה מפורשת
// ─────────────────────────────────────────────────────────────

import { getCookie, setCookie, deleteCookie } from "./cookies"
import { hasAcceptedTracking } from "./consent"

const VISITOR_COOKIE = "madarom_visitor_id"
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api"

function getOrCreateVisitorId() {
  let id = getCookie(VISITOR_COOKIE)
  if (!id) {
    id = crypto.randomUUID()
    setCookie(VISITOR_COOKIE, id, 365)
  }
  return id
}

export function trackPageView(path) {
  if (!hasAcceptedTracking()) return

  try {
    const payload = JSON.stringify({
      path,
      visitorId: getOrCreateVisitorId(),
      referrer: document.referrer || "",
    })

    const sent = navigator.sendBeacon?.(
      `${API_BASE}/catalog/track-visit`,
      new Blob([payload], { type: "application/json" })
    )

    if (!sent) {
      fetch(`${API_BASE}/catalog/track-visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // כשל בשליחת מעקב לא אמור לשבש את חוויית הגלישה
  }
}

export function disableTracking() {
  deleteCookie(VISITOR_COOKIE)
}
