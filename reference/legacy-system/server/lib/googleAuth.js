const { OAuth2Client } = require("google-auth-library")

const client = new OAuth2Client()

function getGoogleClientId() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim()

  if (
    !clientId ||
    clientId.startsWith("your-google-client-id") ||
    !clientId.endsWith(".apps.googleusercontent.com")
  ) {
    return null
  }

  return clientId
}

async function verifyGoogleCredential(credential) {
  const clientId = getGoogleClientId()
  if (!clientId) throw new Error("Google OAuth אינו מוגדר בשרת")

  const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId })
  const payload = ticket.getPayload()
  if (!payload?.email || !payload.email_verified) throw new Error("חשבון Google לא אומת")

  return { name: payload.name || payload.email.split("@")[0], email: payload.email.toLowerCase() }
}

module.exports = { getGoogleClientId, verifyGoogleCredential }
