import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"

function StoresPage() {
  const [stores, setStores] = useState([])
  const [status, setStatus] = useState("loading")

  useEffect(() => {
    setStatus("loading")
    api.get("/catalog/stores")
      .then((data) => {
        setStores(data)
        setStatus("ready")
      })
      .catch(() => setStatus("error"))
  }, [])

  if (status === "loading") {
    return <main className="simple-page"><h1>טוען חנויות...</h1></main>
  }

  if (status === "error") {
    return <main className="simple-page"><h1>שגיאה בטעינת חנויות</h1><p>נסה לרענן את העמוד או בדוק את חיבור הרשת.</p></main>
  }

  return (
    <main className="section stores-section">
      <div className="section-heading"><div><p className="eyebrow">החנויות שלנו</p><h2>בחר חנות לגלישה</h2></div></div>
      {stores.length === 0 ? (
        <p>אין עדיין חנויות פעילות בקניון.</p>
      ) : (
        <div className="store-grid">
          {stores.map((store) => (
            <Link to={`/shop/${store.slug}`} className="store-tile" key={store.slug}>
              <div className="store-avatar clay">{store.name.slice(0, 2)}</div>
              <div>
                <strong>{store.name}</strong>
                <span>{store.category}</span>
              </div>
              <span>←</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}

export default StoresPage
