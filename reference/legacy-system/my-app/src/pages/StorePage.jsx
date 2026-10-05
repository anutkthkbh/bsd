import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { api } from "../api/client"

function StorePage({ addToCart }) {
  const { slug } = useParams()
  const [store, setStore] = useState(null)
  const [products, setProducts] = useState([])
  const [status, setStatus] = useState("loading")

  useEffect(() => {
    setStatus("loading")
    Promise.all([api.get(`/catalog/stores/${slug}`), api.get(`/catalog/products?search=`)])
      .then(([storeData, allProducts]) => { setStore(storeData); setProducts(allProducts.filter((product) => product.storeSlug === slug || product.store === storeData.name)); setStatus("ready") })
      .catch(() => setStatus("missing"))
  }, [slug])

  if (status === "loading") return <main className="simple-page"><h1>טוען...</h1></main>
  if (status === "missing" || !store) return <main className="simple-page"><h1>החנות לא נמצאה</h1><Link className="button button-dark" to="/shop">לכל החנויות ←</Link></main>

  return <main className="store-page">
    <section className="store-hero">
      <div className={`store-avatar large clay`}>{store.name.slice(0, 2)}</div>
      <div><p className="eyebrow">{store.category}</p><h1>{store.name}</h1><p className="hero-text">{store.about}</p><div className="store-contact"><span>☏ {store.phone}</span><span>✉ {store.email}</span></div></div>
    </section>
    <section className="section products-section">
      <div className="section-heading"><div><p className="eyebrow">הקטלוג של החנות</p><h2>מוצרים</h2></div><span className="product-count">{products.length} מוצרים</span></div>
      <div className="product-grid">{products.map((product) => <article className="product-card" key={product.id}><Link to={`/product/${product.id}`} className="product-link"><div className="product-image">{product.badge && <span>{product.badge}</span>}{product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div className="product-shape">תמונה חסרה</div>}{!product.inStock && <div className="out-of-stock-flag">אזל מהמלאי</div>}</div><div className="product-info"><span className="product-store">{product.store}</span><h3>{product.name}</h3></div></Link><div className="price-row"><strong>₪ {product.price}</strong><button onClick={() => addToCart(product)} disabled={!product.inStock} aria-label={`הוסף את ${product.name} לסל`}>+</button></div></article>)}</div>
    </section>
  </main>
}

export default StorePage

