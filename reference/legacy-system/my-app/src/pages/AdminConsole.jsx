import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { api, tokens } from "../api/client"

// ======================================================
// ADMIN LOGIN
// ======================================================

function AdminLogin({ onAuthenticated }) {
  const [searchParams] = useSearchParams()

  const [form, setForm] = useState(() => ({
    email: searchParams.get("email") || "",
    password: "",
  }))

  const [error, setError] = useState("")
  const navigate = useNavigate()

  const submit = async (event) => {
    event.preventDefault()
    setError("")

    try {
      const res = await api.post(
        "/auth/admin/login",
        form
      )

      tokens.set(
        "admin",
        res.token
      )

      tokens.setProfile(
        "admin",
        res.user
      )

      onAuthenticated(
        res.user
      )

      navigate("/admin")
    } catch (err) {
      setError(
        err.message
      )
    }
  }

  return (
    <main className="section merchant-login">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            הנהלת מערכת
          </p>

          <h2>
            התחברות מנהל
          </h2>
        </div>
      </div>

      <div className="crm-panel login-panel">
        {error && (
          <p className="form-error">
            {error}
          </p>
        )}

        <form onSubmit={submit}>
          <label>
            אימייל

            <input
              required
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({
                  ...form,
                  email:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            סיסמה

            <input
              required
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm({
                  ...form,
                  password:
                    event.target.value,
                })
              }
            />
          </label>

          <button
            className="checkout-button"
            type="submit"
          >
            התחברות
          </button>
        </form>
      </div>
    </main>
  )
}

// ======================================================
// ADMIN CONSOLE
// ======================================================

function AdminConsole({
  adminUser,
  onLogout,
}) {
  const navigate =
    useNavigate()

  const [tab, setTab] =
    useState("onboard")

  const [stores, setStores] =
    useState([])

  const [analytics, setAnalytics] =
    useState(null)

  const [refunds, setRefunds] =
    useState([])

  const [closures, setClosures] =
    useState([])

  const [error, setError] =
    useState("")

  const [
    lastCredentials,
    setLastCredentials,
  ] = useState(null)

  const opts = {
    auth: true,
    scope: "admin",
  }

  const load = () => {
    Promise.all([
      api.get(
        "/admin/stores",
        opts
      ),

      api.get(
        "/admin/analytics",
        opts
      ),

      api.get(
        "/admin/refunds",
        opts
      ),

      api.get(
        "/admin/closures",
        opts
      ),
    ])
      .then(
        ([
          storesResult,
          analyticsResult,
          refundsResult,
          closuresResult,
        ]) => {
          setStores(
            storesResult
          )

          setAnalytics(
            analyticsResult
          )

          setRefunds(
            refundsResult
          )

          setClosures(
            closuresResult
          )

          setError("")
        }
      )
      .catch((err) => {
        if (
          String(
            err.message
          ).includes(
            "התחברות"
          )
        ) {
          tokens.set(
            "admin",
            null
          )

          navigate(
            "/admin/login"
          )

          return
        }

        setError(
          err.message
        )
      })
  }

  useEffect(() => {
    if (
      !tokens.get("admin")
    ) {
      navigate(
        "/admin/login"
      )

      return
    }

    load()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (
    !stores.length &&
    !error
  ) {
    return (
      <main className="crm-page">
        <p>
          טוען...
        </p>
      </main>
    )
  }

  const tabs = [
    {
      id: "onboard",
      label:
        "פתיחת חנות חדשה",
    },

    {
      id: "stores",
      label:
        "חנויות",
    },

    {
      id: "refunds",
      label:
        "אישורי זיכוי",
    },

    {
      id: "closures",
      label:
        "לוח סגירות",
    },

    {
      id: "analytics",
      label:
        "נתונים כלליים",
    },
  ]

  return (
    <main className="crm-page">
      <div className="crm-top">
        <div>
          <p className="eyebrow">
            הנהלת מערכת
          </p>

          <h1>
            שלום, {adminUser?.name}.
          </h1>

          <p>
            ה-CRM שדרכו נפתחות
            חנויות חדשות ומנוהלת
            כל הפלטפורמה.
          </p>
        </div>

        <button
          className="button button-dark"
          onClick={() => {
            tokens.set(
              "admin",
              null
            )

            onLogout()

            navigate(
              "/admin/login"
            )
          }}
        >
          התנתקות
        </button>
      </div>

      <div className="crm-tabs">
        {tabs.map(
          (item) => (
            <button
              className={
                tab === item.id
                  ? "active"
                  : ""
              }
              onClick={() =>
                setTab(
                  item.id
                )
              }
              key={item.id}
            >
              {item.label}
            </button>
          )
        )}
      </div>

      {error && (
        <p className="form-error">
          {error}
        </p>
      )}

      {tab === "onboard" && (
        <OnboardTab
          onCreated={(cred) => {
            setLastCredentials(
              cred
            )

            load()
          }}
          lastCredentials={
            lastCredentials
          }
        />
      )}

      {tab === "stores" && (
        <StoresTab
          stores={stores}
          onChanged={load}
        />
      )}

      {tab === "refunds" && (
        <RefundsTab
          refunds={refunds}
          onChanged={load}
        />
      )}

      {tab === "closures" && (
        <ClosuresTab
          closures={closures}
          onChanged={load}
        />
      )}

      {tab === "analytics" &&
        analytics && (
          <AnalyticsTab
            analytics={
              analytics
            }
          />
        )}
    </main>
  )
}

// ======================================================
// ONBOARD STORE
// ======================================================

function OnboardTab({
  onCreated,
  lastCredentials,
}) {
  const opts = {
    auth: true,
    scope: "admin",
  }

  const emptyForm = {
    storeName: "",
    category: "",
    about: "",
    phone: "",
    email: "",
    ownerName: "",
    ownerEmail: "",
    ownerIdNumber: "",
    monthlyAdBudgetCommitted:
      "",
  }

  const [form, setForm] =
    useState(emptyForm)

  const [error, setError] =
    useState("")

  const submit = async (
    event
  ) => {
    event.preventDefault()
    setError("")

    try {
      const res =
        await api.post(
          "/admin/stores",
          form,
          opts
        )

      onCreated(
        res.ownerLogin
      )

      setForm(
        emptyForm
      )
    } catch (err) {
      setError(
        err.message
      )
    }
  }

  return (
    <section className="crm-panel table-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">
            קליטת עסק חדש
          </p>

          <h2>
            פתיחת חנות במערכת
          </h2>
        </div>
      </div>

      {error && (
        <p className="form-error">
          {error}
        </p>
      )}

      {lastCredentials && (
        <p className="checkout-note">
          נוצרה חנות! פרטי
          כניסה לבעל העסק —
          אימייל:{" "}

          <strong>
            {
              lastCredentials.email
            }
          </strong>

          , סיסמה זמנית:{" "}

          <strong>
            {
              lastCredentials.temporaryPassword
            }
          </strong>

          {" "}
          (יש למסור פרטים אלו
          ישירות לבעל העסק).
        </p>
      )}

      <form
        className="inline-form"
        onSubmit={submit}
      >
        <div className="form-grid">
          <label>
            שם החנות

            <input
              required
              value={
                form.storeName
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  storeName:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            קטגוריה

            <input
              required
              value={
                form.category
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  category:
                    event.target.value,
                })
              }
            />
          </label>

          <label className="wide">
            תיאור קצר

            <input
              required
              value={
                form.about
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  about:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            טלפון החנות

            <input
              required
              value={
                form.phone
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  phone:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            אימייל החנות

            <input
              required
              type="email"
              value={
                form.email
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  email:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            שם בעל העסק

            <input
              required
              value={
                form.ownerName
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  ownerName:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            אימייל בעל העסק
            (לכניסה)

            <input
              required
              type="email"
              value={
                form.ownerEmail
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  ownerEmail:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            תעודת זהות בעל העסק

            <input
              required
              value={
                form.ownerIdNumber
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  ownerIdNumber:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            התחייבות פרסום
            חודשית (₪)

            <input
              required
              type="number"
              min="0"
              value={
                form.monthlyAdBudgetCommitted
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  monthlyAdBudgetCommitted:
                    event.target.value,
                })
              }
            />
          </label>
        </div>

        <button
          className="checkout-button"
          type="submit"
        >
          פתיחת חנות
        </button>
      </form>
    </section>
  )
}

// ======================================================
// STORES
// ======================================================

function StoresTab({
  stores,
  onChanged,
}) {
  const opts = {
    auth: true,
    scope: "admin",
  }

  const setStatus = async (
    store,
    status
  ) => {
    await api.patch(
      `/admin/stores/${store.id}/status`,
      {
        status,
      },
      opts
    )

    onChanged()
  }

  const toggleWaiver =
    async (store) => {
      await api.patch(
        `/admin/stores/${store.id}/ad-waiver`,
        {
          granted:
            !store.adWaiverGranted,
        },
        opts
      )

      onChanged()
    }

  return (
    <section className="crm-panel table-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">
            כל החנויות
          </p>

          <h2>
            ניהול חנויות
          </h2>
        </div>

        <span className="product-count">
          {stores.length} חנויות
        </span>
      </div>

      <div className="order-table">
        <div className="table-row table-head">
          <span>
            חנות
          </span>

          <span>
            סטטוס
          </span>

          <span>
            הכנסות
          </span>

          <span>
            פטור פרסום
          </span>

          <span>
            פעולות
          </span>
        </div>

        {stores.map(
          (store) => (
            <div
              className="table-row"
              key={store.id}
            >
              <strong>
                {store.name}
              </strong>

              <span
                className={`order-status ${
                  store.status ===
                  "active"
                    ? "done"
                    : store.status ===
                      "suspended"
                    ? "pending"
                    : "active"
                }`}
              >
                {store.status}
              </span>

              <span>
                ₪{" "}
                {
                  store.revenueTotal
                }
              </span>

              <span>
                {store.adWaiverGranted
                  ? "כן"
                  : "לא"}
              </span>

              <div className="admin-product-actions">
                <button
                  className="text-link"
                  onClick={() =>
                    window.location.assign(
                      `/merchant/${store.slug}`
                    )
                  }
                >
                  פתח חנות
                </button>

                {store.status !==
                  "active" && (
                  <button
                    className="text-link"
                    onClick={() =>
                      setStatus(
                        store,
                        "active"
                      )
                    }
                  >
                    הפעלה
                  </button>
                )}

                {store.status !==
                  "suspended" && (
                  <button
                    className="text-link"
                    onClick={() =>
                      setStatus(
                        store,
                        "suspended"
                      )
                    }
                  >
                    השהיה
                  </button>
                )}

                {store.status !==
                  "removed" && (
                  <button
                    className="text-link danger"
                    onClick={() =>
                      setStatus(
                        store,
                        "removed"
                      )
                    }
                  >
                    הסרה
                  </button>
                )}

                <button
                  className="text-link"
                  onClick={() =>
                    toggleWaiver(
                      store
                    )
                  }
                >
                  {store.adWaiverGranted
                    ? "ביטול פטור"
                    : "מתן פטור"}
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </section>
  )
}

// ======================================================
// REFUNDS
// ======================================================

function RefundsTab({
  refunds,
  onChanged,
}) {
  const opts = {
    auth: true,
    scope: "admin",
  }

  const decide = async (
    refund,
    status
  ) => {
    await api.patch(
      `/admin/refunds/${refund.id}`,
      {
        status,
      },
      opts
    )

    onChanged()
  }

  return (
    <section className="crm-panel table-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">
            ריבוי בקשות זיכוי
          </p>

          <h2>
            ממתין לאישור מערכת
          </h2>
        </div>
      </div>

      {refunds.length === 0 ? (
        <p>
          אין כרגע בקשות
          הממתינות לאישור.
        </p>
      ) : (
        <div className="order-table">
          {refunds.map(
            (refund) => (
              <div
                className="refund-row"
                key={refund.id}
              >
                <div>
                  <strong>
                    {refund.orderId.slice(
                      0,
                      8
                    )}
                  </strong>

                  <span>
                    {
                      refund.reason
                    }
                  </span>
                </div>

                <strong>
                  ₪ {refund.amount}
                </strong>

                <div className="admin-product-actions">
                  <button
                    className="text-link"
                    onClick={() =>
                      decide(
                        refund,
                        "approved"
                      )
                    }
                  >
                    אישור
                  </button>

                  <button
                    className="text-link danger"
                    onClick={() =>
                      decide(
                        refund,
                        "denied"
                      )
                    }
                  >
                    דחייה
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </section>
  )
}

// ======================================================
// PLATFORM CLOSURES
// ======================================================

function ClosuresTab({
  closures,
  onChanged,
}) {
  const opts = {
    auth: true,
    scope: "admin",
  }

  const emptyForm = {
    name: "",
    startsAt: "",
    endsAt: "",
    active: true,
  }

  const [form, setForm] =
    useState(emptyForm)

  const [
    editingId,
    setEditingId,
  ] = useState(null)

  const [error, setError] =
    useState("")

  const submit = async (
    event
  ) => {
    event.preventDefault()
    setError("")

    try {
      if (editingId) {
        await api.patch(
          `/admin/closures/${editingId}`,
          form,
          opts
        )
      } else {
        await api.post(
          "/admin/closures",
          form,
          opts
        )
      }

      setForm(
        emptyForm
      )

      setEditingId(
        null
      )

      onChanged()
    } catch (err) {
      setError(
        err.message
      )
    }
  }

  const startEdit = (
    closure
  ) => {
    setEditingId(
      closure.id
    )

    setForm({
      name:
        closure.name || "",

      startsAt:
        closure.startsAt || "",

      endsAt:
        closure.endsAt || "",

      active:
        closure.active !== false,
    })

    setError("")
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(emptyForm)
    setError("")
  }

  const toggleActive =
    async (closure) => {
      setError("")

      try {
        await api.patch(
          `/admin/closures/${closure.id}`,
          {
            active:
              closure.active ===
              false,
          },
          opts
        )

        onChanged()
      } catch (err) {
        setError(
          err.message
        )
      }
    }

  const remove = async (
    closure
  ) => {
    const approved =
      window.confirm(
        `למחוק את הסגירה "${closure.name}"?`
      )

    if (!approved) {
      return
    }

    setError("")

    try {
      await api.delete(
        `/admin/closures/${closure.id}`,
        opts
      )

      if (
        editingId ===
        closure.id
      ) {
        setEditingId(
          null
        )

        setForm(
          emptyForm
        )
      }

      onChanged()
    } catch (err) {
      setError(
        err.message
      )
    }
  }

  const formatDateTime = (
    value
  ) => {
    if (!value) {
      return "-"
    }

    return String(
      value
    ).replace(
      "T",
      " "
    )
  }

  return (
    <section className="crm-panel table-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">
            שבתות, חגים וסגירות
          </p>

          <h2>
            לוח סגירת המסחר
          </h2>
        </div>

        <span className="product-count">
          {closures.length} סגירות
        </span>
      </div>

      <p className="checkout-note">
        הזן את זמן תחילת
        הסגירה ואת זמן סיום
        הסגירה המדויקים.
        המערכת אינה מחשבת
        זמני שבת או חג באופן
        אוטומטי.
      </p>

      {error && (
        <p className="form-error">
          {error}
        </p>
      )}

      <form
        className="inline-form"
        onSubmit={submit}
      >
        <div className="form-grid">
          <label>
            שם הסגירה

            <input
              required
              placeholder="לדוגמה: שבת פרשת נצבים"
              value={
                form.name
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  name:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            תחילת הסגירה

            <input
              required
              type="datetime-local"
              value={
                form.startsAt
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  startsAt:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            סיום הסגירה

            <input
              required
              type="datetime-local"
              value={
                form.endsAt
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  endsAt:
                    event.target.value,
                })
              }
            />
          </label>

          <label>
            <input
              type="checkbox"
              checked={
                form.active
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  active:
                    event.target.checked,
                })
              }
            />

            {" "}
            סגירה פעילה
          </label>
        </div>

        <div className="admin-product-actions">
          <button
            className="checkout-button"
            type="submit"
          >
            {editingId
              ? "שמירת שינויים"
              : "הוספת סגירה"}
          </button>

          {editingId && (
            <button
              className="text-link"
              type="button"
              onClick={
                cancelEdit
              }
            >
              ביטול עריכה
            </button>
          )}
        </div>
      </form>

      <div className="order-table">
        {closures.length ===
        0 ? (
          <p>
            לא הוגדרו כרגע
            סגירות.
          </p>
        ) : (
          closures.map(
            (closure) => (
              <div
                className="table-row"
                key={
                  closure.id
                }
              >
                <div>
                  <strong>
                    {
                      closure.name
                    }
                  </strong>

                  <div>
                    מ־{" "}
                    {formatDateTime(
                      closure.startsAt
                    )}
                  </div>

                  <div>
                    עד{" "}
                    {formatDateTime(
                      closure.endsAt
                    )}
                  </div>
                </div>

                <span
                  className={`order-status ${
                    closure.active ===
                    false
                      ? "pending"
                      : "done"
                  }`}
                >
                  {closure.active ===
                  false
                    ? "לא פעיל"
                    : "פעיל"}
                </span>

                <div className="admin-product-actions">
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      startEdit(
                        closure
                      )
                    }
                  >
                    עריכה
                  </button>

                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      toggleActive(
                        closure
                      )
                    }
                  >
                    {closure.active ===
                    false
                      ? "הפעלה"
                      : "השבתה"}
                  </button>

                  <button
                    type="button"
                    className="text-link danger"
                    onClick={() =>
                      remove(
                        closure
                      )
                    }
                  >
                    מחיקה
                  </button>
                </div>
              </div>
            )
          )
        )}
      </div>
    </section>
  )
}

// ======================================================
// ANALYTICS
// ======================================================

function AnalyticsTab({
  analytics,
}) {
  return (
    <section className="crm-panel table-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">
            גישה מלאה לנתוני
            הפלטפורמה
          </p>

          <h2>
            נתונים כלליים
          </h2>
        </div>
      </div>

      <div className="crm-metrics">
        <div className="crm-metric">
          <span>
            סך הכנסות
          </span>

          <strong>
            ₪{" "}
            {
              analytics.totalRevenue
            }
          </strong>
        </div>

        <div className="crm-metric">
          <span>
            סך עמלות
          </span>

          <strong>
            ₪{" "}
            {
              analytics.totalFees
            }
          </strong>
        </div>

        <div className="crm-metric">
          <span>
            סך הזמנות
          </span>

          <strong>
            {
              analytics.totalOrders
            }
          </strong>
        </div>

        <div className="crm-metric">
          <span>
            סך לקוחות
          </span>

          <strong>
            {
              analytics.totalCustomers
            }
          </strong>
        </div>

        <div className="crm-metric">
          <span>
            צפיות באתר
            (מעקב מאושר)
          </span>

          <strong>
            {analytics.totalVisits ??
              0}
          </strong>
        </div>
      </div>

      <div className="order-table">
        {analytics.byStore.map(
          (store) => (
            <div
              className="table-row"
              key={
                store.storeId
              }
            >
              <strong>
                {store.name}
              </strong>

              <span>
                {store.orders} הזמנות
              </span>

              <strong>
                ₪ {store.revenue}
              </strong>
            </div>
          )
        )}
      </div>
    </section>
  )
}

export { AdminLogin }
export default AdminConsole