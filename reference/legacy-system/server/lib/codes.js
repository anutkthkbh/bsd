const { randomUUID } = require("crypto")
const { persist } = require("./db")
const { sendMail } = require("./mailer")
const { sendSms, normalizePhone } = require("./sms")

const CODE_TTL_MS = 10 * 60 * 1000
const isProd = process.env.NODE_ENV === "production"

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function saveCode(state, target, purpose, code) {
  const record = {
    id: randomUUID(),
    target,
    purpose,
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
  }

  persist((current) => {
    current.authCodes = current.authCodes.filter(
      (item) => !(item.target === target && item.purpose === purpose)
    )
    current.authCodes.push(record)
  })

  return record
}

function withDevMeta(record, deliveryStatus) {
  const result = {
    ...record,
    deliveryStatus: deliveryStatus || "unknown",
  }

  if (!isProd && deliveryStatus && deliveryStatus !== "sent") {
    result.devCode = record.code
    console.info(`[auth:dev] ${record.purpose} → ${record.target} code=${record.code} (${deliveryStatus})`)
  } else if (!isProd) {
    console.info(`[auth:dev] ${record.purpose} → ${record.target} delivered (${deliveryStatus})`)
  }

  return result
}
async function issueCode(state, email, purpose) {
  const record = saveCode(state, email, purpose, generateCode())

  const delivery = await sendMail({
    to: email,
    subject: `קוד האימות שלך למדרום: ${record.code}`,
    body:
      `קוד האימות שלך הוא ${record.code}.\n\n` +
      `הקוד תקף למשך 10 דקות.\n` +
      `אם לא ביקשת את הקוד, ניתן להתעלם מהודעה זו.`,
  })

  if (!isProd) {
    console.log(
      `[auth:dev] ${purpose} email accepted by Resend`,
      delivery?.id || "no-email-id"
    )
  }

  return withDevMeta(record, "sent")
}

async function issueSmsCode(state, phone, purpose) {
  const normalizedPhone = normalizePhone(phone)
  const record = saveCode(state, normalizedPhone, purpose, generateCode())

  try {
    await sendSms({
      phone: normalizedPhone,
      message: `מדרום: קוד האימות שלך הוא ${record.code}. הקוד תקף למשך 10 דקות.`,
    })
    return withDevMeta(record, "sent")
  } catch (error) {
    if (!isProd) {
      console.warn(`[auth:dev] SMS delivery failed for ${normalizedPhone}: ${error.message}`)
      return withDevMeta(record, "failed")
    }
    throw error
  }
}

function verifyCode(state, target, purpose, code) {
  const record = state.authCodes.find(
    (item) => item.target === target && item.purpose === purpose
  )

  if (!record) return false

  const valid = record.code === String(code) && record.expiresAt > Date.now()

  if (valid) {
    state.authCodes = state.authCodes.filter((item) => item.id !== record.id)
  }

  return valid
}

module.exports = {
  issueCode,
  issueSmsCode,
  verifyCode,
}
