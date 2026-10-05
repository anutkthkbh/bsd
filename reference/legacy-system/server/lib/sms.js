const { randomUUID } = require("crypto")

const SMS_WORKER_URL = process.env.SMS_WORKER_URL
const SMS_WORKER_SECRET = process.env.SMS_WORKER_SECRET

function normalizePhone(phone) {
  const raw = String(phone || "").replace(/[^\d+]/g, "")

  if (raw.startsWith("05")) return "+972" + raw.slice(1)
  if (raw.startsWith("972")) return "+" + raw
  if (raw.startsWith("+972")) return raw

  return raw
}

async function sendSms({ phone, message }) {
  if (!SMS_WORKER_URL || !SMS_WORKER_SECRET) {
    throw new Error("SMS service is not configured")
  }

  const normalizedPhone = normalizePhone(phone)

  const response = await fetch(SMS_WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone: normalizedPhone,
      secret: SMS_WORKER_SECRET,
      message,
      count: 1,
    }),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok || !data?.success) {
    throw new Error(
      data?.error || `SMS provider error (${response.status})`
    )
  }

  return {
    id: randomUUID(),
    phone: normalizedPhone,
    success: true,
    providerResponse: data,
  }
}

module.exports = {
  sendSms,
  normalizePhone,
}