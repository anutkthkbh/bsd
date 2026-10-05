import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api, tokens } from "../api/client"

const emptyForm = { name: "", phone: "", phone2: "", address: "", city: "", zip: "" }

function AccountPage({ customer, onUpdated, onLogout, onRequireAuth }) {
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!customer) {
      setLoading(false)
      return
    }

    setLoading(true)
    api.get("/auth/customer/profile", { auth: true, scope: "customer" })
      .then((res) => {
        setProfile(res)
        setForm({
          name: res.name || "",
          phone: res.phone || "",
          phone2: res.phone2 || "",
          address: res.address || "",
          city: res.city || "",
          zip: res.zip || "",
        })
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [customer])

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setError("")
    setNote("")
    setBusy(true)

    try {
      const res = await api.patch("/auth/customer/profile", form, { auth: true, scope: "customer" })
      setProfile(res)
      tokens.setProfile("customer", { ...tokens.getProfile("customer"), name: res.name })
      onUpdated?.({ ...customer, name: res.name })
      setNote("הפרטים עודכנו בהצלחה")
    } catch (err) {
      setError(err.message || "העדכון נכשל")
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    onLogout?.()
    navigate("/")
  }

  if (!customer) {
    return <main className="section account-page">
      <div className="section-heading"><div><p className="eyebrow">האזור האישי</p><h2>יש להתחבר כדי להמשיך</h2></div></div>
      <div className="crm-panel login-panel">
        <p className="checkout-note">התחברו כדי לצפות ולערוך את הפרטים האישיים שלכם.</p>
        <button className="checkout-button" onClick={onRequireAuth}>התחברות</button>
      </div>
    </main>
  }

  return <main className="section account-page">
    <div className="section-heading"><div><p className="eyebrow">האזור האישי</p><h2>שלום {customer.name?.split(" ")[0]}</h2></div></div>
    <div className="crm-panel login-panel">
      {error && <p className="form-error">{error}</p>}
      {note && <p className="checkout-note">{note}</p>}

      {loading ? <p>טוען פרטים...</p> : <>
        <div className="account-meta">
          <span><strong>אימייל: </strong>{profile?.email}</span>
          <span className={`order-status ${profile?.verified ? "done" : "pending"}`}>
            {profile?.verified ? "מאומת" : "לא מאומת"}{profile?.authProvider === "google" ? " · Google" : ""}
          </span>
        </div>

        <form onSubmit={submit}>
          <div className="form-grid">
            <label>שם מלא<input required value={form.name} onChange={update("name")} /></label>
            <label>טלפון<input required type="tel" inputMode="tel" value={form.phone} onChange={update("phone")} /></label>
            <label><span className="field-label">טלפון נוסף <small>(אופציונלי)</small></span><input type="tel" inputMode="tel" value={form.phone2} onChange={update("phone2")} /></label>
            <label>עיר<input required value={form.city} onChange={update("city")} /></label>
            <label className="wide">כתובת ומספר דירה<input required value={form.address} onChange={update("address")} /></label>
            <label>מיקוד<input required inputMode="numeric" value={form.zip} onChange={update("zip")} /></label>
          </div>
          <button className="checkout-button" disabled={busy} type="submit">{busy ? "שומר..." : "שמירת שינויים"}</button>
        </form>

        <button type="button" className="text-link danger" onClick={logout}>יציאה מהחשבון ←</button>
      </>}
    </div>
  </main>
}

export default AccountPage
