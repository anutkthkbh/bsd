import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { GoogleOAuthProvider } from "@react-oauth/google"

import App from "./App"
import "./style.css"

const API_BASE =
  import.meta.env.VITE_API_URL || "http://localhost:4000/api"

function isGoogleClientId(value) {
  return (
    typeof value === "string" &&
    value.endsWith(".apps.googleusercontent.com") &&
    !value.startsWith("your-google-client-id")
  )
}

async function resolveGoogleClientId() {
  const buildClientId =
    import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()

  if (isGoogleClientId(buildClientId)) {
    return buildClientId
  }

  try {
    const response = await fetch(
      `${API_BASE}/auth/public-config`
    )

    const config =
      response.ok
        ? await response.json()
        : null

    return isGoogleClientId(config?.googleClientId)
      ? config.googleClientId
      : null
  } catch {
    return null
  }
}

async function bootstrap() {
  const googleClientId =
    await resolveGoogleClientId()

  if (!googleClientId) {
    console.info(
      "[Madarom] Google login disabled - client ID is not configured"
    )
  }

  const app = (
    <BrowserRouter>
      <App
        googleEnabled={Boolean(googleClientId)}
      />
    </BrowserRouter>
  )

  const root =
    createRoot(
      document.getElementById("root")
    )

  root.render(
    googleClientId ? (
      <GoogleOAuthProvider
        clientId={googleClientId}
      >
        {app}
      </GoogleOAuthProvider>
    ) : (
      app
    )
  )
}

bootstrap()