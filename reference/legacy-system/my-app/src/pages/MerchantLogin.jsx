import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { api, tokens } from "../api/client"

function MerchantLogin({ onAuthenticated }) {
  const [searchParams] = useSearchParams()
  const [form, setForm] = useState(() => ({
    email: searchParams.get("email") || "",
    password: "",
  }))
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [verifyEmail, setVerifyEmail] = useState(false)
  const [resetStep, setResetStep] = useState("request")
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const navigate = useNavigate()

  const applyDevCode = (res, fallbackMessage = "") => {
    if (res?.devCode) {
      setCode(String(res.devCode))
      setNote(`${res.message || fallbackMessage} (קוד פיתוח: ${res.devCode})`.trim())
    } else {
      setNote(res?.message || fallbackMessage)
    }
  }

  const submit = async (event) => {
    event.preventDefault(); setError(""); setNote(""); setBusy(true)
    try {
      const res = await api.post("/auth/merchant/login", form)
      tokens.set("merchant", res.token)
      tokens.setProfile("merchant", res.user)
      onAuthenticated(res.user)
      navigate(`/merchant/${res.user.storeSlug}`)
    } catch (err) {
      if (err.code === "MANAGER_EMAIL_NOT_VERIFIED" || String(err.message).includes("לאמת את כתובת האימייל")) {
        setVerifyEmail(true)
        setError(err.message)
      } else {
        setError(err.message)
      }
    } finally { setBusy(false) }
  }

  const requestReset = async (event) => {
    event.preventDefault(); setError(""); setNote(""); setBusy(true)
    try {
      const res = await api.post("/auth/merchant/forgot", { email: form.email })
      applyDevCode(res, "קוד איפוס נשלח לאימייל הרשום")
      setResetStep("code")
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const submitReset = async (event) => {
    event.preventDefault(); setError(""); setNote(""); setBusy(true)
    try {
      await api.post("/auth/merchant/reset", { email: form.email, code, newPassword })
      setForgot(false)
      setResetStep("request")
      setCode("")
      setNewPassword("")
      setNote("הסיסמה עודכנה בהצלחה")
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const submitVerify = async (event) => {
    event.preventDefault(); setError(""); setNote(""); setBusy(true)
    try {
      await api.post("/auth/merchant/verify-email", { email: form.email, code })
      setVerifyEmail(false)
      setCode("")
      const res = await api.post("/auth/merchant/login", form)
      tokens.set("merchant", res.token)
      tokens.setProfile("merchant", res.user)
      onAuthenticated(res.user)
      navigate(`/merchant/${res.user.storeSlug}`)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const resendVerify = async () => {
    setError(""); setNote(""); setBusy(true)
    try {
      const res = await api.post("/auth/merchant/resend-verification", { email: form.email })
      applyDevCode(res, "נשלח קוד אימות חדש לאימייל")
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const heading = verifyEmail ? "אימות אימייל מנהל" : forgot ? "שחזור סיסמה" : "התחברות בעלי עסקים"

  return <main className="section merchant-login">
    <div className="section-heading"><div><p className="eyebrow">אזור עסקי</p><h2>{heading}</h2></div></div>
    <div className="crm-panel login-panel">
      {error && <p className="form-error">{error}</p>}
      {note && <p className="checkout-note">{note}</p>}
      {!forgot && !verifyEmail && <form onSubmit={submit}>
        <label>אימייל<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>סיסמה<input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <button className="checkout-button" disabled={busy} type="submit">התחברות</button>
        <button type="button" className="text-link" onClick={() => { setForgot(true); setNote(""); setError("") }}>שכחתי סיסמה ←</button>
      </form>}
      {verifyEmail && <form onSubmit={submitVerify}>
        <p className="checkout-note">שלחנו קוד אימות לאימייל {form.email}. הזן אותו כדי להפעיל את החשבון.</p>
        <label>קוד אימות<input required maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
        <button className="checkout-button" disabled={busy || code.length !== 4} type="submit">אימות והתחברות</button>
        <button type="button" className="text-link" disabled={busy} onClick={resendVerify}>שליחת קוד מחדש</button>
        <button type="button" className="text-link" onClick={() => { setVerifyEmail(false); setCode(""); setNote("") }}>חזרה להתחברות ←</button>
      </form>}
      {forgot && resetStep === "request" && <form onSubmit={requestReset}>
        <label>אימייל רשום במערכת<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <button className="checkout-button" disabled={busy} type="submit">שליחת קוד איפוס</button>
        <button type="button" className="text-link" onClick={() => { setForgot(false); setNote(""); setError("") }}>חזרה להתחברות ←</button>
      </form>}
      {forgot && resetStep === "code" && <form onSubmit={submitReset}>
        <p className="checkout-note">קוד איפוס נשלח לאימייל הרשום.</p>
        <label>קוד<input required maxLength={4} value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <label>סיסמה חדשה<input required type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <button className="checkout-button" disabled={busy} type="submit">עדכון סיסמה</button>
      </form>}
    </div>
  </main>
}

export default MerchantLogin
