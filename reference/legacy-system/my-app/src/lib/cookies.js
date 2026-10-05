// ─────────────────────────────────────────────────────────────
// cookies.js — עזרי עוגיות בסיסיים (ללא ספריות חיצוניות)
// ─────────────────────────────────────────────────────────────

export function setCookie(name, value, days) {
  const maxAge = Math.round(days * 24 * 60 * 60)
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`
}

export function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function deleteCookie(name) {
  document.cookie = `${name}=; max-age=0; path=/`
}
