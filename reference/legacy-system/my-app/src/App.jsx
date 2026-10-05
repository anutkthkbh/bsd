import {
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom"

import Navbar from "./components/Navbar"
import AuthModal from "./components/AuthModal"
import CookieConsent from "./components/CookieConsent"

import MerchantLogin from "./pages/MerchantLogin"
import MerchantCRM from "./pages/MerchantCRM"

import AdminConsole, {
  AdminLogin,
} from "./pages/AdminConsole"

import StorePage from "./pages/StorePage"
import StoresPage from "./pages/StoresPage"
import ProductPage from "./pages/ProductPage"
import Reviews from "./pages/Reviews"
import PrivacyPolicy from "./pages/PrivacyPolicy"
import AccountPage from "./pages/AccountPage"

import {
  api,
  tokens,
} from "./api/client"

import {
  trackPageView,
} from "./lib/tracking"

// ======================================================
// HELPERS
// ======================================================

function cleanText(value) {
  return String(
    value ?? ""
  ).trim()
}

function unique(values) {
  return [
    ...new Set(
      values
        .map(cleanText)
        .filter(Boolean)
    ),
  ]
}

function getCartKey(item) {
  if (item.cartKey) {
    return item.cartKey
  }

  if (item.variantId) {
    return `${item.id}:variant:${item.variantId}`
  }

  if (
    item.selection?.size
  ) {
    return `${item.id}:size:${item.selection.size}`
  }

  return `${item.id}:simple`
}

function getCartOptions(item) {
  const selection =
    item.selection || {}

  return [
    selection.model
      ? `דגם: ${selection.model}`
      : "",

    selection.color
      ? `צבע: ${selection.color}`
      : "",

    selection.size
      ? `מידה: ${selection.size}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

function productNeedsSelection(
  product
) {
  const hasVariants =
    product.inventoryMode ===
      "variants" ||
    (
      Array.isArray(
        product.variants
      ) &&
      product.variants.length >
        0
    )

  if (
    hasVariants &&
    !product.variantId
  ) {
    return true
  }

  if (
    !hasVariants &&
    product.hasSizes &&
    Array.isArray(
      product.sizes
    ) &&
    product.sizes.length >
      0 &&
    !product.selection?.size &&
    !product.selectedSize
  ) {
    return true
  }

  return false
}

function getMaximumQuantity(
  item
) {
  const value =
    item.maxStock ??
    (
      item.variantId
        ? item.selectedVariant
            ?.stockQty
        : item.stockQty
    )

  const number =
    Number(value)

  if (
    !Number.isFinite(
      number
    ) ||
    number <= 0
  ) {
    return Infinity
  }

  return number
}

// ======================================================
// CLOSED BANNER
// ======================================================

function ShabbatBanner({
  reason,
}) {
  return (
    <div
      className="shabbat-banner"
      role="status"
    >
      <span>
        🕯
      </span>

      <p>
        {reason} שלום! הקנייה
        סגורה כרגע, אבל אפשר
        להמשיך לעיין בקטלוג.
      </p>
    </div>
  )
}

// ======================================================
// MARKETPLACE
// ======================================================

function Marketplace({
  addToCart,
}) {
  const navigate =
    useNavigate()

  const [
    query,
    setQuery,
  ] = useState("")

  const [
    category,
    setCategory,
  ] = useState("הכול")

  const [
    categories,
    setCategories,
  ] = useState([
    "הכול",
  ])

  const [
    products,
    setProducts,
  ] = useState([])

  const [
    stores,
    setStores,
  ] = useState([])

  // ====================================================
  // PRODUCTS
  // ====================================================

  useEffect(() => {
    const params =
      new URLSearchParams({
        search:
          query,

        category,
      })

    api
      .get(
        `/catalog/products?${params}`
      )
      .then(
        setProducts
      )
      .catch(() =>
        setProducts([])
      )
  }, [
    query,
    category,
  ])

  // ====================================================
  // STORES
  // ====================================================

  useEffect(() => {
    api
      .get(
        "/catalog/stores"
      )
      .then(
        setStores
      )
      .catch(() =>
        setStores([])
      )
  }, [])

  // ====================================================
  // DYNAMIC CATEGORIES
  // ====================================================

  useEffect(() => {
    const loadCategories =
      async () => {
        try {
          const result =
            await api.get(
              "/catalog/categories"
            )

          if (
            Array.isArray(
              result
            )
          ) {
            const normalized =
              unique(
                result.filter(
                  (item) =>
                    item !==
                    "הכול"
                )
              )

            setCategories([
              "הכול",
              ...normalized,
            ])

            return
          }
        } catch {
          // fallback לגרסה ישנה של השרת
        }

        try {
          const allProducts =
            await api.get(
              "/catalog/products?category=הכול"
            )

          const derived =
            unique(
              (
                allProducts ||
                []
              ).map(
                (product) =>
                  product.category
              )
            ).sort(
              (a, b) =>
                a.localeCompare(
                  b,
                  "he"
                )
            )

          setCategories([
            "הכול",
            ...derived,
          ])
        } catch {
          setCategories([
            "הכול",
          ])
        }
      }

    loadCategories()
  }, [])

  // ====================================================
  // QUICK ADD
  // ====================================================

  const quickAdd = (
    product
  ) => {
    if (
      productNeedsSelection(
        product
      )
    ) {
      navigate(
        `/product/${product.id}`
      )

      return
    }

    addToCart(
      product
    )
  }

  return (
    <main>
      {/* ===============================================
          HERO
      =============================================== */}

      <section className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">
            ✦ עסקים מקומיים,
            במקום אחד
          </p>

          <h1>
            מה שטוב
            <br />

            <em>
              קרוב לבית.
            </em>
          </h1>

          <p className="hero-text">
            מגלים, קונים ותומכים
            בעסקים ישראליים.
            חנויות אמיתיות,
            מוצרים עם סיפור
            ומשלוח עד הדלת.
          </p>

          <a
            className="button button-dark"
            href="#products"
          >
            לגלות את הקניון{" "}
            <span>
              ←
            </span>
          </a>
        </div>

        <figure
          className="hero-art"
          style={{
            margin:
              0,

            overflow:
              "hidden",
          }}
        >
          <img
            src="https://images.unsplash.com/photo-1488459716781-31db52582fe9?auto=format&fit=crop&w=1200&q=85"
            alt="עסק מקומי"
            style={{
              width:
                "100%",

              height:
                "100%",

              display:
                "block",

              objectFit:
                "cover",
            }}
          />

          <figcaption
            style={{
              position:
                "absolute",

              right:
                20,

              bottom:
                18,

              zIndex:
                1,

              padding:
                "7px 12px",

              color:
                "#fff",

              background:
                "rgba(23,32,28,.72)",

              fontSize:
                13,

              fontWeight:
                600,
            }}
          >
            נבחר מהעסקים המקומיים
          </figcaption>
        </figure>
      </section>

      {/* ===============================================
          STORES
      =============================================== */}

      <section className="section stores-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              הכירו את השכנים
            </p>

            <h2>
              חנויות עם אופי
            </h2>
          </div>

          <Link
            to="/shop"
            className="text-link"
          >
            כל החנויות{" "}
            <span>
              ←
            </span>
          </Link>
        </div>

        {stores.length ===
        0 ? (
          <p>
            עדיין אין חנויות
            פעילות בקניון.
          </p>
        ) : (
          <div className="store-grid">
            {stores.map(
              (store) => (
                <Link
                  to={`/shop/${store.slug}`}
                  className="store-tile"
                  key={
                    store.slug
                  }
                >
                  <div className="store-avatar clay">
                    {store.name.slice(
                      0,
                      2
                    )}
                  </div>

                  <div>
                    <strong>
                      {
                        store.name
                      }
                    </strong>

                    <span>
                      {
                        store.category
                      }
                    </span>
                  </div>

                  <span>
                    ←
                  </span>
                </Link>
              )
            )}
          </div>
        )}
      </section>

      {/* ===============================================
          PRODUCTS
      =============================================== */}

      <section
        className="section products-section"
        id="products"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              הכי מבוקש עכשיו
            </p>

            <h2>
              מוצרים שנבחרו בקפידה
            </h2>
          </div>

          <div className="product-count">
            {products.length} מוצרים
          </div>
        </div>

        <div className="toolbar">
          <div className="search-box">
            <span>
              🔎
            </span>

            <input
              value={
                query
              }
              onChange={(
                event
              ) =>
                setQuery(
                  event
                    .target
                    .value
                )
              }
              placeholder="חיפוש מוצר או חנות"
              aria-label="חיפוש מוצר או חנות"
            />
          </div>

          <div className="category-list">
            {categories.map(
              (item) => (
                <button
                  type="button"
                  className={
                    category ===
                    item
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setCategory(
                      item
                    )
                  }
                  key={
                    item
                  }
                >
                  {item}
                </button>
              )
            )}
          </div>
        </div>

        {products.length ===
        0 ? (
          <p>
            לא נמצאו מוצרים
            להצגה.
          </p>
        ) : (
          <div className="product-grid">
            {products.map(
              (product) => (
                <article
                  className="product-card"
                  key={
                    product.id
                  }
                >
                  <Link
                    to={`/product/${product.id}`}
                    className="product-link"
                  >
                    <div className="product-image">
                      {product.badge && (
                        <span>
                          {
                            product.badge
                          }
                        </span>
                      )}

                      {product.imageUrl ? (
                        <img
                          src={
                            product.imageUrl
                          }
                          alt={
                            product.name
                          }
                          loading="lazy"
                          style={{
                            width:
                              "100%",

                            height:
                              "100%",

                            objectFit:
                              "cover",
                          }}
                        />
                      ) : (
                        <div className="product-shape">
                          תמונה חסרה
                        </div>
                      )}

                      {!product.inStock && (
                        <div className="out-of-stock-flag">
                          אזל מהמלאי
                        </div>
                      )}
                    </div>

                    <div className="product-info">
                      <span className="product-store">
                        {
                          product.store
                        }
                      </span>

                      <h3>
                        {
                          product.name
                        }
                      </h3>

                      {product.model && (
                        <small>
                          דגם:{" "}
                          {
                            product.model
                          }
                        </small>
                      )}
                    </div>
                  </Link>

                  <div className="price-row">
                    <strong>
                      ₪{" "}
                      {
                        product.price
                      }
                    </strong>

                    <button
                      type="button"
                      onClick={() =>
                        quickAdd(
                          product
                        )
                      }
                      disabled={
                        !product.inStock
                      }
                      aria-label={
                        productNeedsSelection(
                          product
                        )
                          ? `בחירת אפשרויות עבור ${product.name}`
                          : `הוסף את ${product.name} לסל`
                      }
                    >
                      {productNeedsSelection(
                        product
                      )
                        ? "←"
                        : "+"}
                    </button>
                  </div>
                </article>
              )
            )}
          </div>
        )}
      </section>
    </main>
  )
}

// ======================================================
// CART
// ======================================================

function CartDrawer({
  cart,
  onClose,
  onChange,
  onCheckout,
}) {
  const total =
    cart.reduce(
      (
        sum,
        item
      ) =>
        sum +
        Number(
          item.price ||
            0
        ) *
          item.quantity,
      0
    )

  return (
    <aside
      className="cart-drawer"
      aria-label="עגלת קניות"
    >
      <div className="cart-header">
        <h2>
          העגלה שלך
        </h2>

        <button
          type="button"
          onClick={
            onClose
          }
          aria-label="סגירה"
        >
          ×
        </button>
      </div>

      {cart.length ===
      0 ? (
        <div className="empty-cart">
          <span>
            ♡
          </span>

          <p>
            העגלה עדיין מחכה
            למשהו טוב.
          </p>
        </div>
      ) : (
        <>
          <div className="cart-items">
            {cart.map(
              (item) => {
                const cartKey =
                  getCartKey(
                    item
                  )

                const options =
                  getCartOptions(
                    item
                  )

                const maximum =
                  getMaximumQuantity(
                    item
                  )

                return (
                  <div
                    className="cart-item"
                    key={
                      cartKey
                    }
                  >
                    <div className="cart-thumb">
                      {item.imageUrl && (
                        <img
                          src={
                            item.imageUrl
                          }
                          alt=""
                          style={{
                            width:
                              "100%",

                            height:
                              "100%",

                            objectFit:
                              "cover",
                          }}
                        />
                      )}
                    </div>

                    <div>
                      <strong>
                        {
                          item.name
                        }
                      </strong>

                      <span>
                        {
                          item.store
                        }
                      </span>

                      {options && (
                        <small
                          style={{
                            display:
                              "block",

                            marginTop:
                              4,
                          }}
                        >
                          {options}
                        </small>
                      )}

                      <div className="quantity">
                        <button
                          type="button"
                          onClick={() =>
                            onChange(
                              cartKey,
                              -1
                            )
                          }
                        >
                          -
                        </button>

                        <b>
                          {
                            item.quantity
                          }
                        </b>

                        <button
                          type="button"
                          disabled={
                            Number.isFinite(
                              maximum
                            ) &&
                            item.quantity >=
                              maximum
                          }
                          onClick={() =>
                            onChange(
                              cartKey,
                              1
                            )
                          }
                        >
                          +
                        </button>
                      </div>

                      {Number.isFinite(
                        maximum
                      ) && (
                        <small>
                          עד {maximum} יחידות
                          זמינות
                        </small>
                      )}
                    </div>

                    <strong>
                      ₪{" "}
                      {(
                        Number(
                          item.price ||
                            0
                        ) *
                        item.quantity
                      ).toFixed(
                        2
                      )}
                    </strong>
                  </div>
                )
              }
            )}
          </div>

          <div className="cart-summary">
            <div>
              <span>
                סכום ביניים
              </span>

              <strong>
                ₪{" "}
                {total.toFixed(
                  2
                )}
              </strong>
            </div>

            <small>
              עמלה ומע״מ כלולים
              במחיר. משלוח יחושב
              בשלב הבא.
            </small>

            <button
              className="checkout-button"
              onClick={
                onCheckout
              }
            >
              המשך לתשלום ←
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

// ======================================================
// CUSTOMER PROFILE
// ======================================================

const CUSTOMER_FIELD_LABELS = {
  name:
    "שם מלא",

  email:
    "אימייל",

  phone:
    "טלפון",

  city:
    "עיר",

  address:
    "כתובת ומספר דירה",

  zip:
    "מיקוד",
}

function ProfileCompletionModal({
  missingFields,
  onSaved,
  onClose,
}) {
  const [
    form,
    setForm,
  ] = useState({
    name: "",
    phone: "",
    phone2: "",
    city: "",
    address: "",
    zip: "",
  })

  const [
    loaded,
    setLoaded,
  ] = useState(false)

  const [
    error,
    setError,
  ] = useState("")

  const [
    busy,
    setBusy,
  ] = useState(false)

  useEffect(() => {
    api
      .get(
        "/auth/customer/profile",
        {
          auth:
            true,

          scope:
            "customer",
        }
      )
      .then(
        (res) =>
          setForm({
            name:
              res.name ||
              "",

            phone:
              res.phone ||
              "",

            phone2:
              res.phone2 ||
              "",

            city:
              res.city ||
              "",

            address:
              res.address ||
              "",

            zip:
              res.zip ||
              "",
          })
      )
      .catch(
        (err) =>
          setError(
            err.message
          )
      )
      .finally(() =>
        setLoaded(
          true
        )
      )
  }, [])

  const update =
    (field) =>
    (event) =>
      setForm(
        (current) => ({
          ...current,

          [field]:
            event
              .target
              .value,
        })
      )

  const submit =
    async (event) => {
      event.preventDefault()

      setError("")
      setBusy(true)

      try {
        await api.patch(
          "/auth/customer/profile",
          form,
          {
            auth:
              true,

            scope:
              "customer",
          }
        )

        await onSaved()
      } catch (err) {
        setError(
          err.message
        )
      } finally {
        setBusy(false)
      }
    }

  return (
    <div className="modal-backdrop">
      <section className="checkout-modal">
        <div className="cart-header">
          <div>
            <p className="eyebrow">
              לפני התשלום
            </p>

            <h2>
              השלמת פרטים
            </h2>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            aria-label="סגירה"
          >
            ×
          </button>
        </div>

        <p className="checkout-note">
          {missingFields.length >
          0
            ? "חסרים מספר פרטים בחשבון שלך. כדי שנוכל להעביר את ההזמנה לחנות ולבצע את המשלוח, יש להשלים אותם לפני המעבר לתשלום."
            : "אפשר לעדכן את פרטי המשלוח לפני המשך לתשלום."}
        </p>

        {error && (
          <p className="form-error">
            {error}
          </p>
        )}

        {missingFields.length >
          0 && (
          <ul className="checklist">
            {Object.entries(
              CUSTOMER_FIELD_LABELS
            ).map(
              ([
                key,
                label,
              ]) => (
                <li
                  key={
                    key
                  }
                  className={
                    missingFields.includes(
                      key
                    )
                      ? "missing"
                      : "present"
                  }
                >
                  {missingFields.includes(
                    key
                  )
                    ? "✕"
                    : "✓"}{" "}
                  {label}
                </li>
              )
            )}
          </ul>
        )}

        {!loaded ? (
          <p>
            טוען...
          </p>
        ) : (
          <form
            onSubmit={
              submit
            }
          >
            <div className="form-grid">
              <label>
                שם מלא

                <input
                  required
                  value={
                    form.name
                  }
                  onChange={
                    update(
                      "name"
                    )
                  }
                />
              </label>

              <label>
                טלפון

                <input
                  required
                  type="tel"
                  inputMode="tel"
                  value={
                    form.phone
                  }
                  onChange={
                    update(
                      "phone"
                    )
                  }
                />
              </label>

              <label>
                <span className="field-label">
                  טלפון נוסף{" "}
                  <small>
                    (אופציונלי)
                  </small>
                </span>

                <input
                  type="tel"
                  inputMode="tel"
                  value={
                    form.phone2
                  }
                  onChange={
                    update(
                      "phone2"
                    )
                  }
                />
              </label>

              <label>
                עיר

                <input
                  required
                  value={
                    form.city
                  }
                  onChange={
                    update(
                      "city"
                    )
                  }
                />
              </label>

              <label className="wide">
                כתובת ומספר דירה

                <input
                  required
                  value={
                    form.address
                  }
                  onChange={
                    update(
                      "address"
                    )
                  }
                />
              </label>

              <label>
                מיקוד

                <input
                  required
                  inputMode="numeric"
                  value={
                    form.zip
                  }
                  onChange={
                    update(
                      "zip"
                    )
                  }
                />
              </label>
            </div>

            <button
              className="checkout-button"
              disabled={
                busy
              }
              type="submit"
            >
              {busy
                ? "שומר..."
                : "שמירת הפרטים והמשך"}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}

// ======================================================
// CHECKOUT
// ======================================================

function Checkout({
  cart,
  onClose,
  onComplete,
}) {
  const [
    step,
    setStep,
  ] = useState(
    "loading"
  )

  const [
    missingFields,
    setMissingFields,
  ] = useState([])

  const [
    session,
    setSession,
  ] = useState(null)

  const [
    result,
    setResult,
  ] = useState(null)

  const [
    error,
    setError,
  ] = useState("")

  const [
    busy,
    setBusy,
  ] = useState(false)

  // ====================================================
  // CART -> CHECKOUT API
  // ====================================================

  const checkoutItems =
    useMemo(
      () =>
        cart.map(
          (item) => ({
            productId:
              item.id,

            variantId:
              item.variantId ||
              null,

            selection: {
              model:
                item.selection
                  ?.model ||
                item.selectedModel ||
                "",

              color:
                item.selection
                  ?.color ||
                item.selectedColor ||
                "",

              size:
                item.selection
                  ?.size ||
                item.selectedSize ||
                "",
            },

            qty:
              item.quantity,
          })
        ),
      [cart]
    )

  const prepare =
    async () => {
      setError("")
      setBusy(true)

      try {
        const readiness =
          await api.get(
            "/auth/customer/checkout-readiness",

            {
              auth:
                true,

              scope:
                "customer",
            }
          )

        if (
          !readiness.ready
        ) {
          setMissingFields(
            readiness.missingFields ||
              []
          )

          setSession(null)

          setStep(
            "profile"
          )

          return
        }

        const prepared =
          await api.post(
            "/orders/checkout/prepare",

            {
              items:
                checkoutItems,
            },

            {
              auth:
                true,

              scope:
                "customer",
            }
          )

        setMissingFields([])
        setSession(prepared)
        setStep("confirm")
      } catch (err) {
        setError(
          err?.message ||
            "לא ניתן להתחיל את תהליך התשלום"
        )

        setStep(
          "error"
        )
      } finally {
        setBusy(false)
      }
    }

  useEffect(() => {
    prepare()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleProfileSaved =
    async () => {
      setStep(
        "loading"
      )

      await prepare()
    }

  const handleEdit = () => {
    setMissingFields([])
    setStep("profile")
  }

  const handleConfirm =
    async () => {
      if (
        !session?.checkoutId ||
        busy
      ) {
        return
      }

      setBusy(true)
      setError("")

      try {
        const response =
          await api.post(
            "/orders/checkout/pay",

            {
              checkoutId:
                session.checkoutId,
            },

            {
              auth:
                true,

              scope:
                "customer",
            }
          )

        setResult(
          response
        )

        setStep(
          "success"
        )
      } catch (err) {
        setError(
          err?.message ||
            "התשלום לא הושלם"
        )
      } finally {
        setBusy(false)
      }
    }

  if (
    step ===
    "loading"
  ) {
    return (
      <div className="modal-backdrop">
        <section className="checkout-modal">
          <div className="cart-header">
            <div>
              <p className="eyebrow">
                לפני התשלום
              </p>

              <h2>
                בודקים את ההזמנה
              </h2>
            </div>

            <button
              type="button"
              onClick={
                onClose
              }
              aria-label="סגירה"
            >
              ×
            </button>
          </div>

          <p className="checkout-note">
            טוען את פרטי החשבון,
            המלאי והמחירים
            העדכניים...
          </p>
        </section>
      </div>
    )
  }

  if (
    step ===
    "profile"
  ) {
    return (
      <ProfileCompletionModal
        missingFields={
          missingFields
        }
        onSaved={
          handleProfileSaved
        }
        onClose={
          onClose
        }
      />
    )
  }

  if (
    step ===
      "confirm" &&
    session
  ) {
    return (
      <CheckoutConfirm
        session={
          session
        }
        busy={
          busy
        }
        error={
          error
        }
        onEdit={
          handleEdit
        }
        onConfirm={
          handleConfirm
        }
        onClose={
          onClose
        }
      />
    )
  }

  if (
    step ===
      "success" &&
    result?.masterOrder
  ) {
    return (
      <CheckoutSuccess
        masterOrder={
          result.masterOrder
        }
        loyaltyCoupon={
          result.loyaltyCoupon
        }
        onComplete={
          onComplete
        }
      />
    )
  }

  return (
    <div className="modal-backdrop">
      <section className="checkout-modal">
        <div className="cart-header">
          <div>
            <p className="eyebrow">
              לא ניתן להמשיך
            </p>

            <h2>
              שגיאה בתהליך התשלום
            </h2>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            aria-label="סגירה"
          >
            ×
          </button>
        </div>

        <p className="form-error">
          {error ||
            "אירעה שגיאה לא צפויה"}
        </p>

        <button
          className="checkout-button"
          disabled={
            busy
          }
          onClick={() => {
            setStep(
              "loading"
            )

            prepare()
          }}
        >
          נסה שוב
        </button>
      </section>
    </div>
  )
}

// ======================================================
// CHECKOUT CONFIRM
// ======================================================

function CheckoutConfirm({
  session,
  busy,
  error,
  onEdit,
  onConfirm,
  onClose,
}) {
  return (
    <div className="modal-backdrop">
      <section className="checkout-modal">
        <div className="cart-header">
          <div>
            <p className="eyebrow">
              שלב אחרון
            </p>

            <h2>
              אישור פרטי ההזמנה
              והמשלוח
            </h2>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            aria-label="סגירה"
          >
            ×
          </button>
        </div>

        {error && (
          <p className="form-error">
            {error}
          </p>
        )}

        <div className="order-summary">
          <div className="summary-line">
            <span>
              שם
            </span>

            <b>
              {
                session.customer
                  .name
              }
            </b>
          </div>

          <div className="summary-line">
            <span>
              טלפון
            </span>

            <b>
              {
                session.customer
                  .phone
              }
            </b>
          </div>

          <div className="summary-line">
            <span>
              אימייל
            </span>

            <b>
              {
                session.customer
                  .email
              }
            </b>
          </div>

          <div className="summary-line">
            <span>
              כתובת
            </span>

            <b>
              {
                session.customer
                  .address
              }
            </b>
          </div>

          <div className="summary-line">
            <span>
              עיר
            </span>

            <b>
              {
                session.customer
                  .city
              }
            </b>
          </div>

          <div className="summary-line">
            <span>
              מיקוד
            </span>

            <b>
              {
                session.customer
                  .zip
              }
            </b>
          </div>

          <hr />

          {session.stores.map(
            (store) => (
              <div
                key={
                  store.storeId
                }
                className="checkout-store-group"
              >
                <strong>
                  {
                    store.storeName
                  }
                </strong>

                {store.items.map(
                  (
                    item,
                    index
                  ) => {
                    const options = [
                      item.options
                        ?.model
                        ? `דגם: ${item.options.model}`
                        : "",

                      item.options
                        ?.color
                        ? `צבע: ${item.options.color}`
                        : "",

                      item.options
                        ?.size
                        ? `מידה: ${item.options.size}`
                        : "",
                    ]
                      .filter(
                        Boolean
                      )
                      .join(
                        " · "
                      )

                    return (
                      <div
                        className="summary-line"
                        key={`${item.productId}-${item.variantId || "simple"}-${index}`}
                      >
                        <span>
                          {item.name} ×{" "}
                          {item.qty}

                          {options && (
                            <small
                              style={{
                                display:
                                  "block",
                              }}
                            >
                              {options}
                            </small>
                          )}
                        </span>

                        <b>
                          ₪{" "}
                          {(
                            Number(
                              item.unitPrice ||
                                0
                            ) *
                            item.qty
                          ).toFixed(
                            2
                          )}
                        </b>
                      </div>
                    )
                  }
                )}

                <div className="summary-line">
                  <span>
                    משלוח
                  </span>

                  <b>
                    ₪{" "}
                    {
                      store.shipping
                    }
                  </b>
                </div>

                {store.discount >
                  0 && (
                  <div className="summary-line">
                    <span>
                      הנחת קופון
                    </span>

                    <b>
                      -₪{" "}
                      {
                        store.discount
                      }
                    </b>
                  </div>
                )}
              </div>
            )
          )}

          <hr />

          <div className="summary-line total">
            <strong>
              סכום כולל לתשלום
            </strong>

            <strong>
              ₪{" "}
              {
                session.total
              }
            </strong>
          </div>
        </div>

        <p className="checkout-note">
          בלחיצה על "הפרטים
          נכונים – המשך לתשלום"
          יבוצע החיוב על סמך
          הפרטים שאושרו כאן.
        </p>

        <button
          className="checkout-button"
          disabled={
            busy
          }
          onClick={
            onConfirm
          }
        >
          {busy
            ? "מבצע תשלום..."
            : "הפרטים נכונים – המשך לתשלום"}
        </button>

        <button
          type="button"
          className="text-link"
          disabled={
            busy
          }
          onClick={
            onEdit
          }
        >
          עריכת פרטים ←
        </button>
      </section>
    </div>
  )
}

// ======================================================
// CHECKOUT SUCCESS
// ======================================================

function CheckoutSuccess({
  masterOrder,
  loyaltyCoupon,
  onComplete,
}) {
  return (
    <div className="modal-backdrop">
      <section className="checkout-modal confirmation">
        <span className="success-mark">
          ✓
        </span>

        <p className="eyebrow">
          ההזמנה התקבלה
        </p>

        <h2>
          תודה!
        </h2>

        <p>
          נוצרה הזמנה #
          {masterOrder.id.slice(
            0,
            8
          )}{" "}
          בסך ₪{" "}
          {
            masterOrder.total
          }
          , מפוצלת ל-
          {
            masterOrder
              .storeOrders
              .length
          }{" "}
          חנויות. אישור וסיכום
          יישלחו במייל.
        </p>

        {loyaltyCoupon && (
          <p className="coupon-note">
            ✓ זו הרכישה השלישית
            שלך — קיבלת קופון תודה
            בקוד{" "}
            {
              loyaltyCoupon.code
            }{" "}
            ל-
            {
              loyaltyCoupon.percentOff
            }
            % הנחה!
          </p>
        )}

        <button
          className="button button-dark"
          onClick={
            onComplete
          }
        >
          חזרה לקניון
        </button>
      </section>
    </div>
  )
}

// ======================================================
// SIMPLE PAGE
// ======================================================

function SimplePage({
  title,
  text,
}) {
  return (
    <main className="simple-page">
      <p className="eyebrow">
        ✦ מדרום
      </p>

      <h1>
        {title}
      </h1>

      <p>
        {text}
      </p>

      <Link
        className="button button-dark"
        to="/"
      >
        חזרה לקניון{" "}
        <span>
          ←
        </span>
      </Link>
    </main>
  )
}

// ======================================================
// APP
// ======================================================

function App({
  googleEnabled = false,
}) {
  const [
    cart,
    setCart,
  ] = useState([])

  const [
    cartOpen,
    setCartOpen,
  ] = useState(false)

  const [
    checkoutOpen,
    setCheckoutOpen,
  ] = useState(false)

  const [
    authOpen,
    setAuthOpen,
  ] = useState(false)

  const [
    customer,
    setCustomer,
  ] = useState(() =>
    tokens.get(
      "customer"
    )
      ? tokens.getProfile(
          "customer"
        )
      : null
  )

  const [
    merchantUser,
    setMerchantUser,
  ] = useState(() =>
    tokens.get(
      "merchant"
    )
      ? tokens.getProfile(
          "merchant"
        )
      : null
  )

  const [
    adminUser,
    setAdminUser,
  ] = useState(() =>
    tokens.get(
      "admin"
    )
      ? tokens.getProfile(
          "admin"
        )
      : null
  )

  const [
    closure,
    setClosure,
  ] = useState(null)

  const navigate =
    useNavigate()

  const location =
    useLocation()

  // ====================================================
  // PLATFORM STATUS
  // ====================================================

  useEffect(() => {
    api
      .get(
        "/catalog/status"
      )
      .then(
        (res) =>
          setClosure(
            res.closed
              ? res
              : null
          )
      )
      .catch(() => {})
  }, [])

  // ====================================================
  // TRACKING
  // ====================================================

  useEffect(() => {
    trackPageView(
      location.pathname
    )
  }, [
    location.pathname,
  ])

  // ====================================================
  // ADD TO CART
  // ====================================================

  const addToCart = (
    product
  ) => {
    // מוצר עם אפשרויות לא נכנס
    // ישירות מהקטלוג בלי בחירה.
    if (
      productNeedsSelection(
        product
      )
    ) {
      navigate(
        `/product/${product.id}`
      )

      setCartOpen(
        false
      )

      return
    }

    const normalizedSelection = {
      model:
        product.selection
          ?.model ||
        product.selectedModel ||
        "",

      color:
        product.selection
          ?.color ||
        product.selectedColor ||
        "",

      size:
        product.selection
          ?.size ||
        product.selectedSize ||
        "",
    }

    const normalized = {
      ...product,

      selection:
        normalizedSelection,

      variantId:
        product.variantId ||
        product
          .selectedVariant
          ?.id ||
        null,
    }

    normalized.cartKey =
      getCartKey(
        normalized
      )

    setCart(
      (current) => {
        const existing =
          current.find(
            (item) =>
              getCartKey(
                item
              ) ===
              normalized.cartKey
          )

        if (
          !existing
        ) {
          return [
            ...current,

            {
              ...normalized,

              quantity:
                1,
            },
          ]
        }

        const maximum =
          getMaximumQuantity(
            existing
          )

        return current.map(
          (item) => {
            if (
              getCartKey(
                item
              ) !==
              normalized.cartKey
            ) {
              return item
            }

            const nextQuantity =
              item.quantity +
              1

            return {
              ...item,

              quantity:
                Number.isFinite(
                  maximum
                )
                  ? Math.min(
                      nextQuantity,
                      maximum
                    )
                  : nextQuantity,
            }
          }
        )
      }
    )

    setCartOpen(
      true
    )
  }

  // ====================================================
  // CHANGE QUANTITY
  // ====================================================

  const changeQuantity = (
    cartKey,
    change
  ) => {
    setCart(
      (current) =>
        current
          .map(
            (item) => {
              if (
                getCartKey(
                  item
                ) !==
                cartKey
              ) {
                return item
              }

              const maximum =
                getMaximumQuantity(
                  item
                )

              let quantity =
                item.quantity +
                change

              if (
                Number.isFinite(
                  maximum
                )
              ) {
                quantity =
                  Math.min(
                    quantity,
                    maximum
                  )
              }

              return {
                ...item,

                quantity,
              }
            }
          )
          .filter(
            (item) =>
              item.quantity >
              0
          )
    )
  }

  const itemCount =
    cart.reduce(
      (
        sum,
        item
      ) =>
        sum +
        item.quantity,
      0
    )

  // ====================================================
  // CHECKOUT
  // ====================================================

  const requestCheckout =
    () => {
      setCartOpen(
        false
      )

      if (
        customer
      ) {
        setCheckoutOpen(
          true
        )
      } else {
        setAuthOpen(
          true
        )
      }
    }

  // ====================================================
  // AUTH
  // ====================================================

  const handleAuthenticated =
    (user) => {
      setCustomer(
        user
      )

      setAuthOpen(
        false
      )

      if (
        cart.length >
        0
      ) {
        setCheckoutOpen(
          true
        )
      }
    }

  const handleMerchantAuthenticated =
    (user) => {
      setMerchantUser(
        user
      )

      setAuthOpen(
        false
      )

      if (
        user?.storeSlug
      ) {
        navigate(
          `/merchant/${user.storeSlug}`
        )
      }
    }

  const handleAdminAuthenticated =
    (user) => {
      setAdminUser(
        user
      )

      setAuthOpen(
        false
      )

      navigate(
        "/admin"
      )
    }

  const completeOrder =
    () => {
      setCart([])
      setCheckoutOpen(
        false
      )
    }

  const logoutCustomer =
    () => {
      tokens.set(
        "customer",
        null
      )

      tokens.setProfile(
        "customer",
        null
      )

      setCustomer(
        null
      )
    }

  // ====================================================
  // UI
  // ====================================================

  return (
    <>
      <Navbar
        cartCount={
          itemCount
        }
        onCartOpen={() =>
          setCartOpen(
            true
          )
        }
        user={
          customer
        }
        onAccountClick={() =>
          setAuthOpen(
            true
          )
        }
      />

      {closure && (
        <ShabbatBanner
          reason={
            closure.reason
          }
        />
      )}

      <Routes>
        <Route
          path="/"
          element={
            <Marketplace
              addToCart={
                addToCart
              }
            />
          }
        />

        <Route
          path="/shop"
          element={
            <StoresPage />
          }
        />

        <Route
          path="/shop/:slug"
          element={
            <StorePage
              addToCart={
                addToCart
              }
            />
          }
        />

        <Route
          path="/product/:id"
          element={
            <ProductPage
              addToCart={
                addToCart
              }
            />
          }
        />

        <Route
          path="/services"
          element={
            <SimplePage
              title="הכלים שמקדמים עסק"
              text="CRM, סליקה, נתונים ותמיכה לעסקים המקומיים."
            />
          }
        />

        <Route
          path="/about"
          element={
            <SimplePage
              title="קונים קרוב, צומחים יחד"
              text="מדרום נבנה כדי לתת לכל עסק מקומי נוכחות דיגיטלית אמיתית."
            />
          }
        />

        <Route
          path="/contact"
          element={
            <SimplePage
              title="אנחנו כאן"
              text="נציגי השירות שלנו זמינים בשעות הפעילות."
            />
          }
        />

        <Route
          path="/reviews"
          element={
            <Reviews
              user={
                customer
              }
              onRequireAuth={() =>
                setAuthOpen(
                  true
                )
              }
            />
          }
        />

        <Route
          path="/account"
          element={
            <AccountPage
              customer={
                customer
              }
              onUpdated={
                setCustomer
              }
              onLogout={
                logoutCustomer
              }
              onRequireAuth={() =>
                setAuthOpen(
                  true
                )
              }
            />
          }
        />

        <Route
          path="/merchant/login"
          element={
            <MerchantLogin
              onAuthenticated={
                setMerchantUser
              }
            />
          }
        />

        <Route
          path="/merchant/:slug"
          element={
            <MerchantCRM
              merchantUser={
                merchantUser
              }
              adminUser={
                adminUser
              }
              onLogout={() => {
                if (
                  merchantUser
                ) {
                  setMerchantUser(
                    null
                  )
                } else {
                  setAdminUser(
                    null
                  )
                }
              }}
            />
          }
        />

        <Route
          path="/admin/login"
          element={
            <AdminLogin
              onAuthenticated={
                setAdminUser
              }
            />
          }
        />

        <Route
          path="/admin"
          element={
            <AdminConsole
              adminUser={
                adminUser
              }
              onLogout={() =>
                setAdminUser(
                  null
                )
              }
            />
          }
        />

        <Route
          path="/privacy"
          element={
            <PrivacyPolicy />
          }
        />
      </Routes>

      {cartOpen && (
        <CartDrawer
          cart={
            cart
          }
          onClose={() =>
            setCartOpen(
              false
            )
          }
          onChange={
            changeQuantity
          }
          onCheckout={
            requestCheckout
          }
        />
      )}

      {checkoutOpen && (
        <Checkout
          cart={
            cart
          }
          onClose={() =>
            setCheckoutOpen(
              false
            )
          }
          onComplete={
            completeOrder
          }
        />
      )}

      {authOpen && (
        <AuthModal
          googleEnabled={
            googleEnabled
          }
          onClose={() =>
            setAuthOpen(
              false
            )
          }
          onAuthenticated={
            handleAuthenticated
          }
          onMerchantAuthenticated={
            handleMerchantAuthenticated
          }
          onAdminAuthenticated={
            handleAdminAuthenticated
          }
        />
      )}

      <footer>
        <span>
          מדרום © 2026
        </span>

        <span>
          הקניון הדיגיטלי של
          העסקים המקומיים
        </span>

        <button
          className="footer-link"
          onClick={() =>
            navigate(
              "/privacy"
            )
          }
        >
          פרטיות ועוגיות
        </button>
      </footer>

      <CookieConsent />
    </>
  )
}

export default App