import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { GoogleLogin } from "@react-oauth/google"
import { api, tokens } from "../api/client"

// ─────────────────────────────────────────────────────────────
// AuthModal
//
// התחברות: ברירת מחדל Google; אפשרות לקוד מייל או SMS
// הרשמה: פרטים + קוד לאימייל בלבד (אין SMS בהרשמה); גם Google
// ─────────────────────────────────────────────────────────────

function AuthModal({ googleEnabled = false, onClose, onAuthenticated, onMerchantAuthenticated, onAdminAuthenticated }) {
  // login כברירת מחדל — Google ראשון
  const [mode, setMode] = useState("login") // signup | login
  const [step, setStep] = useState("details") // details | verify | password | login-channel

  const [businessFlow, setBusinessFlow] = useState(null) // merchant-password | admin-password
  const [password, setPassword] = useState("")

  const [verificationFlow, setVerificationFlow] = useState("verify") // verify | login
  const [verificationMethod, setVerificationMethod] = useState("email") // email | sms
  const [loginChannel, setLoginChannel] = useState("email") // email | sms

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    phone2: "",
    address: "",
    city: "",
    zip: "",
  })

  const [code, setCode] = useState("")
  const [customerId, setCustomerId] = useState(null)

  const [serverMessage, setServerMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const navigate = useNavigate()

  const update = (field) => (e) => {
    setForm((current) => ({
      ...current,
      [field]: e.target.value,
    }))
  }

  const finishAuth = ({ token, user }) => {
    if (!token || !user) {
      throw new Error("השרת לא החזיר נתוני התחברות תקינים")
    }

    tokens.set("customer", token)
    tokens.setProfile("customer", user)
    onAuthenticated(user)
  }

  const formatCodeMessage = (res, fallback = "נשלח קוד") => {
    const base = res?.message || fallback
    if (res?.devCode) {
      return `${base} (קוד פיתוח: ${res.devCode})`
    }
    return base
  }

  const redirectToManagementLogin = (res) => {
    const path = res.redirectTo || (
      res.flow === "admin-password" ? "/admin/login" : "/merchant/login"
    )
    const email = String(res.email || form.email || "").trim()
    const query = email ? `?${new URLSearchParams({ email })}` : ""

    onClose?.()
    navigate(`${path}${query}`)
  }

  const prepareCodeStep = (res, fallbackFlow = "verify") => {
    if (res.flow === "merchant-password" || res.flow === "admin-password") {
      redirectToManagementLogin(res)
      return
    }

    const nextFlow = res.flow || fallbackFlow
    const nextMethod = res.verificationMethod || "email"

    setCustomerId(res.customerId || customerId || null)
    setVerificationFlow(nextFlow)
    setVerificationMethod(nextMethod)
    if (nextFlow === "login") setLoginChannel(nextMethod)
    setServerMessage(formatCodeMessage(res, "נשלח קוד"))
    if (res?.devCode) setCode(String(res.devCode))
    else setCode("")
    setStep("verify")
  }

  // ======================================================
  // SIGNUP — אימות באימייל בלבד
  // ======================================================

  const submitSignup = async (e) => {
    e.preventDefault()
    setError("")
    setServerMessage("")
    setBusy(true)

    try {
      const res = await api.post("/auth/customer/signup", form)
      prepareCodeStep(res, "verify")
    } catch (err) {
      setError(err.message || "לא ניתן להשלים את ההרשמה")
    } finally {
      setBusy(false)
    }
  }

  // ======================================================
  // REQUEST LOGIN CODE (email | sms)
  // ======================================================

  const requestLoginCode = async (channel) => {
    console.log("[AuthModal] requestLoginCode fired", {
  channel,
  email: form.email,
})
    setError("")
    setServerMessage("")
    setBusy(true)
    setLoginChannel(channel)


    try {
      const res = await api.post("/auth/customer/request-code", {
        email: form.email,
        channel,
      })
      prepareCodeStep(res, "login")
    } catch (err) {
      setError(err.message || "לא ניתן לשלוח קוד התחברות")
    } finally {
      setBusy(false)
    }
  }

  const openLoginChannelStep = async (e) => {
    e.preventDefault()
    setError("")
    if (!form.email?.trim()) {
      setError("יש להזין אימייל")
      return
    }

    setBusy(true)
    try {
      const account = await api.post("/auth/account-type", { email: form.email })

      if (account.type === "merchant" || account.type === "admin") {
        redirectToManagementLogin(account)
        return
      }

      setStep("login-channel")
    } catch (err) {
      setError(err.message || "לא ניתן לזהות את החשבון")
    } finally {
      setBusy(false)
    }
  }

  // ======================================================
  // VERIFY / LOGIN WITH CODE
  // ======================================================

  const submitCode = async (e) => {
    e.preventDefault()
    setError("")
    setBusy(true)

    try {
      let res

      if (verificationFlow === "login") {
        res = await api.post("/auth/customer/login", {
          email: form.email,
          code,
          channel: verificationMethod === "sms" ? "sms" : "email",
        })
      } else {
        if (!customerId) {
          throw new Error("חסר מזהה לקוח. חזור למסך הקודם ונסה שוב.")
        }
        res = await api.post("/auth/customer/verify", {
          customerId,
          code,
        })
      }

      finishAuth(res)
    } catch (err) {
      setError(err.message || "קוד האימות אינו תקין")
    } finally {
      setBusy(false)
    }
  }

  // ======================================================
  // RESEND CODE
  // ======================================================

  const resendCode = async () => {
    if (resending || busy) return

    setError("")
    setServerMessage("")
    setResending(true)

    try {
      let res

      if (verificationFlow === "login") {
        res = await api.post("/auth/customer/request-code", {
          email: form.email,
          channel: verificationMethod === "sms" ? "sms" : "email",
        })
      } else {
        if (!customerId) {
          throw new Error("חסר מזהה לקוח. חזור למסך הקודם ונסה שוב.")
        }
        res = await api.post("/auth/customer/resend-verification", {
          customerId,
        })
      }

      setVerificationFlow(res.flow || verificationFlow)
      setVerificationMethod(res.verificationMethod || verificationMethod)
      if (res.customerId) setCustomerId(res.customerId)
      setServerMessage(formatCodeMessage(res, "נשלח קוד חדש"))
      if (res?.devCode) setCode(String(res.devCode))
      else setCode("")
    } catch (err) {
      setError(err.message || "שליחת הקוד מחדש נכשלה")
    } finally {
      setResending(false)
    }
  }

  // ======================================================
  // BUSINESS PASSWORD
  // ======================================================

  const submitPassword = async (e) => {
    e.preventDefault()
    setError("")
    setBusy(true)

    try {
      if (businessFlow === "admin-password") {
        const res = await api.post("/auth/admin/login", {
          email: form.email,
          password,
        })
        tokens.set("admin", res.token)
        tokens.setProfile("admin", res.user)
        onAdminAuthenticated?.(res.user)
      } else {
        const res = await api.post("/auth/merchant/login", {
          email: form.email,
          password,
        })
        tokens.set("merchant", res.token)
        tokens.setProfile("merchant", res.user)
        onMerchantAuthenticated?.(res.user)
      }
    } catch (err) {
      if (
        err.code === "MANAGER_EMAIL_NOT_VERIFIED" ||
        String(err.message || "").includes("לאמת את כתובת האימייל")
      ) {
        onClose?.()
        window.location.assign("/merchant/login")
        return
      }
      setError(err.message || "ההתחברות נכשלה")
    } finally {
      setBusy(false)
    }
  }

  // ======================================================
  // GOOGLE
  // ======================================================

  const handleGoogleSuccess = async (credentialResponse) => {
    if (!credentialResponse?.credential) {
      setError("לא התקבל אישור התחברות מ-Google")
      return
    }

    setError("")
    setBusy(true)

    try {
      const res = await api.post("/auth/customer/google", {
        credential: credentialResponse.credential,
      })
      finishAuth(res)
    } catch (err) {
      if (err.code === "MANAGEMENT_ACCOUNT" && err.redirectTo) {
        redirectToManagementLogin(err)
        return
      }
      setError(err.message || "ההתחברות עם Google נכשלה")
    } finally {
      setBusy(false)
    }
  }

  const handleGoogleError = () => {
    setError("ההתחברות עם Google נכשלה. נסה שוב או קבל קוד לאימייל.")
  }

  // ======================================================
  // NAVIGATION
  // ======================================================

  const resetCodeState = () => {
    setStep("details")
    setCode("")
    setCustomerId(null)
    setServerMessage("")
    setError("")
    setVerificationFlow("verify")
    setVerificationMethod("email")
    setLoginChannel("email")
    setBusinessFlow(null)
    setPassword("")
  }

  const switchToLogin = () => {
    setMode("login")
    resetCodeState()
  }

  const switchToSignup = () => {
    setMode("signup")
    resetCodeState()
  }

  const goBack = () => {
    if (step === "login-channel") {
      setStep("details")
      setError("")
      return
    }
    if (step === "verify" && verificationFlow === "login") {
      setStep("login-channel")
      setCode("")
      setError("")
      setServerMessage("")
      return
    }
    resetCodeState()
  }

  // ======================================================
  // UI HELPERS
  // ======================================================

  const title =
    step === "password"
      ? businessFlow === "admin-password"
        ? "כניסה להנהלת מערכת"
        : "כניסה לאזור העסקי"
      : step === "login-channel"
        ? "קבלת קוד התחברות"
        : step === "verify"
          ? verificationFlow === "login"
            ? "קוד התחברות"
            : "אימות החשבון"
          : mode === "signup"
            ? "פתיחת חשבון"
            : "התחברות"
  const verificationDestination =
    verificationMethod === "sms"
      ? form.phone || "הטלפון הרשום"
      : form.email

  const verificationChannelText =
    verificationMethod === "sms"
      ? "ב-SMS למספר"
      : "לאימייל"
    const submitButtonText =
    verificationFlow === "login"
      ? "אישור והתחברות"
      : "אישור והשלמת הרשמה"

  const renderGoogleBlock = (text) =>
    googleEnabled ? (
      <div className="google-login-wrapper">
        <GoogleLogin
          onSuccess={handleGoogleSuccess}
          onError={handleGoogleError}
          text={text}
          locale="he"
          shape="rectangular"
          size="large"
          width="320"
        />
      </div>
    ) : (
      <div className="google-login-unavailable" role="status">
        <strong>התחברות עם Google</strong>
        <small>הכניסה תופעל לאחר הגדרת Google OAuth במערכת.</small>
      </div>
    )

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="auth-modal">
        <div className="cart-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="סגירת חלון">
            ×
          </button>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {step === "details" && (
          <div className="auth-mode-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "active" : ""}
              onClick={switchToLogin}
            >
              התחברות
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={mode === "signup" ? "active" : ""}
              onClick={switchToSignup}
            >
              הרשמה
            </button>
          </div>
        )}

        {/* ==================================================
            LOGIN — Google default
        ================================================== */}

        {step === "details" && mode === "login" && (
          <div className="auth-login-default">
            <p className="checkout-note">
              הדרך המהירה להתחבר — חשבון Google.
            </p>

       {renderGoogleBlock("signin_with")}

            <div className="auth-divider">
              <span>או</span>
            </div>

            <form onSubmit={openLoginChannelStep} noValidate>
              <label className="wide">
                קבלת קוד לאימייל / SMS
                <input
                  required
                  type="email"
                  autoComplete="email"
                  placeholder="האימייל הרשום בחשבון"
                  value={form.email}
                  onChange={update("email")}
                />
              </label>

              <button className="checkout-button" disabled={busy} type="submit">
                המשך לקבלת קוד
              </button>
            </form>

          </div>
        )}

        {/* ==================================================
            LOGIN CHANNEL — email or SMS
        ================================================== */}

        {step === "login-channel" && mode === "login" && (
          <div className="auth-login-channel">
            <p className="checkout-note">
              לאן לשלוח את קוד ההתחברות עבור{" "}
              <strong>{form.email}</strong>?
            </p>

            <div className="verification-method">
              <label
                className={`verification-option ${loginChannel === "email" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="loginChannel"
                  value="email"
                  checked={loginChannel === "email"}
                  onChange={() => setLoginChannel("email")}
                />
                <span>
                  <strong>קוד לאימייל</strong>
                  <small>יישלח לכתובת הרשומה</small>
                </span>
              </label>

              <label
                className={`verification-option ${loginChannel === "sms" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="loginChannel"
                  value="sms"
                  checked={loginChannel === "sms"}
                  onChange={() => setLoginChannel("sms")}
                />
                <span>
                  <strong>קוד ב-SMS</strong>
                  <small>יישלח למספר הטלפון הרשום בחשבון</small>
                </span>
              </label>
            </div>

            <button
              className="checkout-button"
              disabled={busy}
              type="button"
              onClick={() => requestLoginCode(loginChannel)}
            >
              {busy
                ? "שולח..."
                : loginChannel === "sms"
                  ? "שליחת קוד ב-SMS"
                  : "שליחת קוד לאימייל"}
            </button>

            <button type="button" className="text-link" disabled={busy} onClick={goBack}>
              ← חזרה
            </button>
          </div>
        )}

        {/* ==================================================
            SIGNUP — email verification only (no SMS)
        ================================================== */}

        {step === "details" && mode === "signup" && (
          <form onSubmit={submitSignup} noValidate>
            {googleEnabled && (
              <>
                <p className="checkout-note">אפשר גם להירשם במהירות עם Google.</p>
               {renderGoogleBlock("signup_with")}
                <div className="auth-divider">
                  <span>או מילוי פרטים</span>
                </div>
              </>
            )}

            <div className="form-grid">
              <label>
                שם מלא
                <input required autoComplete="name" value={form.name} onChange={update("name")} />
              </label>

              <label>
                אימייל
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={update("email")}
                />
              </label>

              <label>
                טלפון
                <input
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={update("phone")}
                />
              </label>

              <label>
                <span className="field-label">
                  טלפון נוסף <small>(אופציונלי)</small>
                </span>
                <input type="tel" inputMode="tel" value={form.phone2} onChange={update("phone2")} />
              </label>

              <label>
                עיר
                <input
                  required
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={update("city")}
                />
              </label>

              <label className="wide">
                כתובת ומספר דירה
                <input
                  required
                  autoComplete="street-address"
                  value={form.address}
                  onChange={update("address")}
                />
              </label>

              <label>
                מיקוד
                <input
                  required
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={form.zip}
                  onChange={update("zip")}
                />
              </label>
            </div>

            <p className="checkout-note">
              לאחר ההרשמה יישלח קוד אימות <strong>לאימייל</strong> בלבד.
            </p>

            <button className="checkout-button" disabled={busy} type="submit">
              {busy ? "שולח..." : "שליחת קוד אימות לאימייל"}
            </button>
          </form>
        )}

        {/* ==================================================
            BUSINESS PASSWORD
        ================================================== */}

        {step === "password" && (
          <form onSubmit={submitPassword} noValidate>
            {serverMessage && <p className="checkout-note">{serverMessage}</p>}

            <label className="wide">
              סיסמה
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </label>

            <button className="checkout-button" disabled={busy || !password} type="submit">
              {busy ? "מתחבר..." : "התחברות"}
            </button>

            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => {
                onClose?.()
                window.location.assign(
                  businessFlow === "admin-password" ? "/admin/login" : "/merchant/login"
                )
              }}
            >
              שכחתי סיסמה ←
            </button>

            <button type="button" className="text-link" disabled={busy} onClick={goBack}>
              ← חזרה
            </button>
          </form>
        )}

        {/* ==================================================
            CODE STEP
        ================================================== */}

        {step === "verify" && (
          <form onSubmit={submitCode} noValidate>
            {serverMessage && <p className="checkout-note">{serverMessage}</p>}

            <p className="checkout-note">
              הקוד נשלח {verificationChannelText}{" "}
              <strong>{verificationDestination}</strong>.
            </p>

            <label className="wide">
              קוד אימות
              <input
                required
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="0000"
                autoFocus
              />
            </label>

            <button
              className="checkout-button"
              disabled={busy || resending || code.length !== 4}
              type="submit"
            >
              {busy ? "מאמת..." : submitButtonText}
            </button>

            <button
              type="button"
              className="text-link"
              disabled={busy || resending}
              onClick={resendCode}
            >
              {resending ? "שולח קוד חדש..." : "לא קיבלתי קוד — שליחה מחדש"}
            </button>

            <button type="button" className="text-link" disabled={busy || resending} onClick={goBack}>
              ← חזרה
            </button>
          </form>
        )}
      </section>
    </div>
  )
}

export default AuthModal
