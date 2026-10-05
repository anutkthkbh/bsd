import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { getConsent, setConsent } from "../lib/consent"
import { trackPageView, disableTracking } from "../lib/tracking"

function CookieConsent({ onDecision }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(!getConsent())
  }, [])

  const accept = () => {
    setConsent("accepted")
    setVisible(false)
    onDecision?.("accepted")
    trackPageView(window.location.pathname)
  }

  const decline = () => {
    setConsent("declined")
    disableTracking()
    setVisible(false)
    onDecision?.("declined")
  }

  if (!visible) return null

  return (
    <div className="cookie-consent" role="dialog" aria-live="polite" aria-label="הסכמה לשימוש בעוגיות">
      <p>
        אנחנו משתמשים בעוגיות ובקבצי מעקב הכרחיים להפעלת האתר, ובעוגיות אנליטיקה (לא הכרחיות) כדי
        להבין אילו עמודים פופולריים ולשפר את החוויה. אפשר לקרוא את הפרטים המלאים ב
        <Link to="/privacy"> מדיניות הפרטיות והעוגיות</Link>.
      </p>
      <div className="cookie-consent-actions">
        <button type="button" className="button button-dark" onClick={accept}>מאשר/ת הכול</button>
        <button type="button" className="text-link" onClick={decline}>רק עוגיות הכרחיות</button>
      </div>
    </div>
  )
}

export default CookieConsent
