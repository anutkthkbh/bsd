import { useState } from "react"
import { Link } from "react-router-dom"
import { getConsent, setConsent } from "../lib/consent"
import { disableTracking, trackPageView } from "../lib/tracking"

function PrivacyPolicy() {
  const [consent, setConsentState] = useState(getConsent())
  const [agreed, setAgreed] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const submitDeclaration = (event) => {
    event.preventDefault()
    if (!agreed) return

    setConsent("accepted")
    setConsentState("accepted")
    setSubmitted(true)
    trackPageView(window.location.pathname)
  }

  const revoke = () => {
    setConsent("declined")
    setConsentState("declined")
    disableTracking()
    setSubmitted(false)
  }

  return (
    <main className="simple-page privacy-page">
      <p className="eyebrow">✦ מדרום</p>
      <h1>מדיניות פרטיות ועוגיות</h1>

      <section>
        <h2>אילו נתונים אנחנו אוספים</h2>
        <p>
          כדי להפעיל את הקניון אנחנו שומרים את הפרטים שנמסרים בטופס ההרשמה (שם, אימייל, טלפון וכתובת
          למשלוח), פרטי הזמנות, וטוקן התחברות זמני בזיכרון הדפדפן (sessionStorage) שנמחק כשסוגרים את
          הטאב.
        </p>
      </section>

      <section>
        <h2>עוגיות וקבצי מעקב</h2>
        <p>אנחנו מבחינים בין שני סוגי עוגיות:</p>
        <ul>
          <li><strong>הכרחיות</strong> — נדרשות לתפעול בסיסי של האתר (למשל שמירת מצב ההתחברות). אלה פעילות תמיד.</li>
          <li>
            <strong>אנליטיקה / מעקב (לא הכרחיות)</strong> — עוגיית מזהה גולש/ת אנונימית (
            <code>madarom_visitor_id</code>) שנוצרת רק לאחר הסכמה, ומשמשת אותנו כדי לספור צפיות בעמודים
            ולהבין אילו חנויות ומוצרים מעניינים יותר. אין קישור בין המזהה הזה לשם או לפרטי קשר, אלא אם
            נרשמת/התחברת לחשבון.
          </li>
        </ul>
      </section>

      <section>
        <h2>שיתוף עם צדדים שלישיים</h2>
        <p>
          אנחנו לא מוכרים ולא משתפים את נתוני הגלישה שלך עם גורמים חיצוניים. אימות דרך Google מתבצע מול
          שרתי Google בלבד לצורך אימות זהות, ואיננו מקבלים או שומרים את הסיסמה שלך שם.
        </p>
      </section>

      <section>
        <h2>הזכויות שלך</h2>
        <p>
          אפשר בכל עת לבטל את ההסכמה למעקב בעמוד הזה, למחוק את עוגיית המזהה מהדפדפן, או לפנות אלינו
          לבקשת מחיקת מידע אישי.
        </p>
      </section>

      <section className="privacy-declaration">
        <h2>הצהרת פרטיות — אישור המשתמש/ת</h2>

        {consent === "accepted" && !submitted && (
          <p className="checkout-note">כבר אישרת את מדיניות הפרטיות והעוגיות בעבר.</p>
        )}

        {submitted && (
          <p className="checkout-note">✓ ההסכמה נשמרה. תודה!</p>
        )}

        <form onSubmit={submitDeclaration} className="privacy-form">
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            קראתי ואני מאשר/ת את מדיניות הפרטיות והעוגיות המפורטת לעיל.
          </label>

          <div className="privacy-form-actions">
            <button className="checkout-button" type="submit" disabled={!agreed}>
              אישור הצהרת הפרטיות
            </button>

            {consent === "accepted" && (
              <button type="button" className="text-link" onClick={revoke}>
                ביטול ההסכמה למעקב
              </button>
            )}
          </div>
        </form>
      </section>

      <Link className="button button-dark" to="/">חזרה לקניון ←</Link>
    </main>
  )
}

export default PrivacyPolicy
