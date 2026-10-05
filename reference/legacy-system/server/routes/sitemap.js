// ─────────────────────────────────────────────────────────────
// routes/sitemap.js — SEO sitemap.xml generation
// הוסף ב-index.js: app.use("/", sitemapRoutes)
// ─────────────────────────────────────────────────────────────

const { Router } = require("express")
const { getState } = require("../lib/db")

const router = Router()

const BASE_URL = process.env.SITE_URL || "https://madarom.co.il"

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function urlEntry(loc, { lastmod, changefreq = "weekly", priority = "0.8" } = {}) {
  return [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : "",
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].filter(Boolean).join("\n")
}

// GET /sitemap.xml
router.get("/sitemap.xml", (req, res) => {
  const state = getState()
  const today = new Date().toISOString().slice(0, 10)

  const staticPages = [
    urlEntry(`${BASE_URL}/`,        { changefreq: "daily",   priority: "1.0", lastmod: today }),
    urlEntry(`${BASE_URL}/shop`,    { changefreq: "daily",   priority: "0.9", lastmod: today }),
    urlEntry(`${BASE_URL}/reviews`, { changefreq: "weekly",  priority: "0.7" }),
    urlEntry(`${BASE_URL}/about`,   { changefreq: "monthly", priority: "0.5" }),
    urlEntry(`${BASE_URL}/contact`, { changefreq: "monthly", priority: "0.4" }),
  ]

  // דפי חנויות
  const storePages = state.stores
    .filter((s) => s.status === "active")
    .map((s) =>
      urlEntry(`${BASE_URL}/shop/${escapeXml(s.slug)}`, {
        changefreq: "weekly",
        priority: "0.8",
        lastmod: (s.joinedAt || today).slice(0, 10),
      })
    )

  // דפי מוצרים
  const productPages = state.products
    .filter((p) => p.inStock)
    .map((p) =>
      urlEntry(`${BASE_URL}/product/${escapeXml(p.id)}`, {
        changefreq: "weekly",
        priority: "0.7",
      })
    )

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9',
    '          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">',
    ...staticPages,
    ...storePages,
    ...productPages,
    "</urlset>",
  ].join("\n")

  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Cache-Control", "public, max-age=3600") // cache שעה
  res.send(xml)
})

// GET /robots.txt
router.get("/robots.txt", (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8")
  res.send(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /admin/",
      "Disallow: /merchant/",
      "",
      `Sitemap: ${BASE_URL}/sitemap.xml`,
    ].join("\n")
  )
})

module.exports = router
