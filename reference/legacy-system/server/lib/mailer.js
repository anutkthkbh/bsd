const { Resend } = require("resend")

function getResend() {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured")
  }

  return new Resend(apiKey)
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function normalizeRecipients(to) {
  const recipients = Array.isArray(to) ? to : [to]

  return recipients
    .map((item) => String(item || "").trim())
    .filter(Boolean)
}

async function sendMail({
  to,
  subject,
  body,
  html,
  attachments = [],
  idempotencyKey,
  kind = "general",
}) {
  const from = process.env.MAIL_FROM

  if (!from) {
    throw new Error("MAIL_FROM is not configured")
  }

  if (!subject) {
    throw new Error("Email subject is missing")
  }

  const requestedRecipients = normalizeRecipients(to)

  if (requestedRecipients.length === 0) {
    throw new Error("Email recipient is missing")
  }

  // בסביבת development בלבד ניתן להפנות את כל המיילים
  // לכתובת בדיקה אחת.
  // ב-production ההגדרה מתעלמת לחלוטין.
  const devEmailOverride =
    process.env.NODE_ENV !== "production"
      ? String(process.env.DEV_EMAIL_OVERRIDE || "").trim()
      : ""

  const deliveryRecipients = devEmailOverride
    ? [devEmailOverride]
    : requestedRecipients

  if (devEmailOverride) {
    console.log(
      `[mailer] DEV override: ${requestedRecipients.join(", ")} -> ${devEmailOverride}`
    )
  }

  const resend = getResend()

  const payload = {
    from,
    to: deliveryRecipients,
    subject,
    text: body || undefined,
    html:
      html ||
      (
        body
          ? `<div dir="rtl" style="font-family:Arial,sans-serif;white-space:pre-line">${escapeHtml(body)}</div>`
          : undefined
      ),
    attachments,
  }

  const options = idempotencyKey
    ? { idempotencyKey }
    : undefined

  const { data, error } =
    await resend.emails.send(payload, options)

  if (error) {
    console.error(
      "[mailer] FAILED:",
      "kind=",
      kind,
      "subject=",
      subject,
      "error=",
      error.message || error
    )

    throw new Error(
      error.message || "Email delivery failed"
    )
  }

  console.log(
    "[mailer] SENT:",
    data?.id || "no-id",
    "| kind:",
    kind,
    "| subject:",
    subject
  )

  return data
}

module.exports = {
  sendMail,
}