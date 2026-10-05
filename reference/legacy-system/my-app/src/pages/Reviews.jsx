import { useEffect, useState } from "react"
import { api } from "../api/client"

function Stars({ count }) { return <span className="stars" aria-label={`${count} מתוך 5 כוכבים`}>{"★".repeat(count)}{"☆".repeat(5 - count)}</span> }

function Reviews({ user, onRequireAuth }) {
  const [reviews, setReviews] = useState([])
  const [stores, setStores] = useState([])
  const [form, setForm] = useState({ storeSlug: "", rating: 5, text: "" })
  const [error, setError] = useState("")

  useEffect(() => {
    api.get("/catalog/reviews").then(setReviews).catch(() => {})
    api.get("/catalog/stores").then((list) => { setStores(list); if (list[0]) setForm((f) => ({ ...f, storeSlug: list[0].slug })) }).catch(() => {})
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    if (!user) return onRequireAuth()
    setError("")
    try { const review = await api.post("/catalog/reviews", form, { auth: true, scope: "customer" }); setReviews([review, ...reviews]); setForm({ ...form, text: "" }) }
    catch (err) { setError(err.message) }
  }

  return <main className="section reviews-page">
    <div className="section-heading"><div><p className="eyebrow">שקיפות מלאה</p><h2>ביקורות ומשוב</h2></div></div>
    <div className="reviews-layout">
      <form className="crm-panel review-form" onSubmit={submit}>
        <h3>שתפו חוויה</h3>
        {error && <p className="form-error">{error}</p>}
        {!user && <p className="checkout-note">יש להתחבר כדי להשאיר ביקורת.</p>}
        <label>שם החנות<select value={form.storeSlug} onChange={(event) => setForm({ ...form, storeSlug: event.target.value })}>{stores.map((store) => <option value={store.slug} key={store.slug}>{store.name}</option>)}</select></label>
        <label>דירוג<select value={form.rating} onChange={(event) => setForm({ ...form, rating: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map((n) => <option value={n} key={n}>{n} כוכבים</option>)}</select></label>
        <label>חוות דעת<textarea required rows={3} value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} /></label>
        <button className="checkout-button" type="submit">{user ? "שליחת משוב" : "התחברות ושליחת משוב"}</button>
      </form>
      <div className="review-list">{reviews.map((review) => <div className="review-card" key={review.id}><div className="review-top"><strong>{review.author}</strong><Stars count={review.rating} /></div><span className="product-store">{review.storeName}</span><p>{review.text}</p></div>)}</div>
    </div>
  </main>
}

export default Reviews

