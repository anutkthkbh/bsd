import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { api, tokens } from "../api/client"

// ======================================================
// HELPERS
// ======================================================

function Metric({ label, value }) {
  return (
    <div className="crm-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const FULFILLMENT_OPTIONS = [
  ["new", "הזמנה חדשה"],
  ["confirmed", "אושרה"],
  ["preparing", "בהכנה"],
  ["ready", "מוכנה"],
  ["shipped", "נשלחה"],
  ["delivered", "נמסרה"],
  ["cancelled", "בוטלה"],
]

function paymentStatusLabel(status) {
  if (status === "paid") return "שולם"
  if (status === "failed") return "נכשל"
  if (status === "refunded") return "זוכה"
  if (status === "partially_refunded") return "זוכה חלקית"
  if (status === "cancelled") return "בוטל"

  return status || "לא ידוע"
}

function createClientId() {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto?.randomUUID
  ) {
    return globalThis.crypto.randomUUID()
  }

  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  )
}

function safeNumber(value, fallback = 0) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return fallback
  }

  return number
}

function isHttpsUrl(value) {
  if (!value) return true

  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

function optionDescription(item) {
  const options = item?.options || {}

  return [
    options.model
      ? `דגם: ${options.model}`
      : "",

    options.color
      ? `צבע: ${options.color}`
      : "",

    options.size
      ? `מידה: ${options.size}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

// ======================================================
// MAIN CRM
// ======================================================

function MerchantCRM({
  merchantUser,
  adminUser,
  onLogout,
}) {
  const { slug } = useParams()
  const navigate = useNavigate()

  const [tab, setTab] = useState("overview")

  const [store, setStore] = useState(null)
  const [products, setProducts] = useState([])
  const [orders, setOrders] = useState([])
  const [coupons, setCoupons] = useState([])
  const [wallet, setWallet] = useState(null)
  const [analytics, setAnalytics] = useState(null)

  const [error, setError] = useState("")

  const viewer =
    merchantUser ||
    adminUser

  const isOwner =
    viewer?.role === "owner"

  const isAdmin =
    viewer?.role === "admin"

  const isManager =
    viewer?.role === "manager"

  const permissions =
    viewer?.permissions || {}

  const can = (permission) =>
    isOwner ||
    isAdmin ||
    Boolean(
      permissions[permission]
    )

  const buildQuery = () => {
    if (!isAdmin) {
      return ""
    }

    return `?storeSlug=${encodeURIComponent(slug)}`
  }

  const load = () => {
    const opts = {
      auth: true,

      scope:
        isAdmin
          ? "admin"
          : "merchant",
    }

    Promise.all([
      api.get(
        `/merchant/store${buildQuery()}`,
        opts
      ),

      api.get(
        `/merchant/products${buildQuery()}`,
        opts
      ),

      api.get(
        `/merchant/orders${buildQuery()}`,
        opts
      ),

      api.get(
        `/merchant/coupons${buildQuery()}`,
        opts
      ),

      api.get(
        `/merchant/wallet${buildQuery()}`,
        opts
      ),

      api.get(
        `/merchant/analytics${buildQuery()}`,
        opts
      ),
    ])
      .then(
        ([
          storeResult,
          productsResult,
          ordersResult,
          couponsResult,
          walletResult,
          analyticsResult,
        ]) => {
          setStore(storeResult)
          setProducts(productsResult)
          setOrders(ordersResult)
          setCoupons(couponsResult)
          setWallet(walletResult)
          setAnalytics(analyticsResult)
          setError("")
        }
      )
      .catch((err) => {
        setError(
          err.message ||
            "טעינת נתוני החנות נכשלה"
        )
      })
  }

  useEffect(() => {
    if (
      !tokens.get("merchant") &&
      !tokens.get("admin")
    ) {
      navigate(
        isAdmin
          ? "/admin/login"
          : "/merchant/login"
      )

      return
    }

    load()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isAdmin])

  if (!store) {
    return (
      <main className="crm-page">
        {error ? (
          <p className="form-error">
            {error}
          </p>
        ) : (
          <p>
            טוען נתוני חנות...
          </p>
        )}
      </main>
    )
  }

  const tabs = [
    {
      id: "overview",
      label: "סקירה",
    },

    {
      id: "orders",
      label: "הזמנות",
    },

    {
      id: "products",
      label: "מוצרים ומלאי",
    },

    {
      id: "wallet",
      label: "ארנק וזיכויים",
    },

    {
      id: "marketing",
      label: "פרסום וקופונים",
    },

    {
      id: "settings",
      label: "הגדרות חנות",
    },

    ...(
      isOwner ||
      isAdmin
        ? [
            {
              id: "managers",
              label: "מנהלים",
            },
          ]
        : []
    ),
  ]

  return (
    <main className="crm-page">
      <div className="crm-top">
        <div>
          <p className="eyebrow">
            אזור עסקי · {store.name}

            {isAdmin
              ? " · מנהל מערכת"
              : isManager
              ? " · מנהל חנות"
              : !isOwner
              ? " · רואה חשבון"
              : ""}
          </p>

          <h1>
            שלום, {viewer?.name}.
          </h1>

          <p>
            הנה תמונת המצב של החנות.
          </p>
        </div>

        <div className="crm-actions">
          <span
            className={`status-pill ${
              store.status !== "active"
                ? "warn"
                : ""
            }`}
          >
            <i />

            החנות{" "}
            {store.status === "active"
              ? "פעילה"
              : store.status ===
                "suspended"
              ? "מושהית"
              : "הוסרה"}
          </span>

          <button
            className="button button-dark"
            onClick={() => {
              if (isAdmin) {
                tokens.set(
                  "admin",
                  null
                )
              } else {
                tokens.set(
                  "merchant",
                  null
                )
              }

              onLogout?.()

              navigate(
                isAdmin
                  ? "/admin/login"
                  : "/merchant/login"
              )
            }}
          >
            התנתקות
          </button>
        </div>
      </div>

      <div className="crm-tabs">
        {tabs.map((item) => (
          <button
            className={
              tab === item.id
                ? "active"
                : ""
            }
            onClick={() =>
              setTab(item.id)
            }
            key={item.id}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="form-error">
          {error}
        </p>
      )}

      {tab === "overview" && (
        <>
          <div className="crm-metrics">
            <Metric
              label="הכנסות כוללות"
              value={`₪ ${store.revenueTotal || 0}`}
            />

            <Metric
              label="הזמנות"
              value={
                analytics?.orderCount ??
                0
              }
            />

            <Metric
              label="ביקורות"
              value={
                analytics?.reviewCount ??
                0
              }
            />

            <Metric
              label="דירוג ממוצע"
              value={
                analytics?.rating
                  ? `${analytics.rating.toFixed(
                      1
                    )} / 5`
                  : "אין עדיין"
              }
            />
          </div>

          <section className="crm-panel campaign-panel">
            <p className="eyebrow">
              התחייבות פרסום
            </p>

            <h2>
              תקציב פרסום חודשי
            </h2>

            <p>
              ₪{" "}
              {
                store.monthlyAdBudgetSpent
              }{" "}
              מתוך ₪{" "}
              {
                store.monthlyAdBudgetCommitted
              }
            </p>

            <small>
              {store.adWaiverGranted
                ? "החנות קיבלה פטור מדמי פרסום"
                : "יש להשקיע בפרסום לפי תנאי ההצטרפות"}
            </small>
          </section>
        </>
      )}

      {tab === "orders" && (
        <OrdersTab
          orders={orders}
          canWrite={can("orders")}
          isAdmin={isAdmin}
          storeSlug={slug}
          onChanged={load}
        />
      )}

      {tab === "products" && (
        <ProductsTab
          products={products}
          canWrite={can("products")}
          isAdmin={isAdmin}
          storeSlug={slug}
          onChanged={load}
        />
      )}

      {tab === "wallet" &&
        wallet && (
          <WalletTab
            wallet={wallet}
            orders={orders}
            canWrite={can("wallet")}
            canRefund={can("refunds")}
            isAdmin={isAdmin}
            storeSlug={slug}
            onChanged={load}
          />
        )}

      {tab === "marketing" && (
        <CouponsTab
          coupons={coupons}
          canWrite={can("coupons")}
          isAdmin={isAdmin}
          storeSlug={slug}
          onChanged={load}
        />
      )}

      {tab === "settings" && (
        <SettingsTab
          store={store}
          canWrite={can("settings")}
          isAdmin={isAdmin}
          storeSlug={slug}
          onChanged={load}
        />
      )}

      {tab === "managers" &&
        (isOwner || isAdmin) && (
          <ManagersTab
            isAdmin={isAdmin}
            storeSlug={slug}
            onChanged={load}
          />
        )}
    </main>
  )
}

// ======================================================
// ORDERS
// ======================================================

function OrdersTab({
  orders,
  canWrite,
  isAdmin,
  storeSlug,
  onChanged,
}) {
  const opts = {
    auth: true,

    scope:
      isAdmin
        ? "admin"
        : "merchant",
  }

  const qs =
    isAdmin &&
    storeSlug
      ? `?storeSlug=${encodeURIComponent(
          storeSlug
        )}`
      : ""

  return (
    <section className="crm-panel table-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">
            ניהול הזמנות
          </p>

          <h2>
            כל ההזמנות
          </h2>
        </div>

        <span className="product-count">
          {orders.length} הזמנות
        </span>
      </div>

      <div className="order-table">
        <div className="table-row table-head">
          <span>
            מספר הזמנה
          </span>

          <span>
            פריטים ופרטי לקוח
          </span>

          <span>
            סכום
          </span>

          <span>
            טיפול
          </span>
        </div>

        {orders.map((order) => {
          const customer =
            order.customerSnapshot ||
            {}

          const fulfillmentStatus =
            order.fulfillmentStatus ||
            "new"

          return (
            <div
              className="table-row"
              key={order.id}
            >
              <strong>
                {order.id.slice(
                  0,
                  8
                )}

                <small
                  style={{
                    display:
                      "block",

                    fontWeight:
                      400,
                  }}
                >
                  תשלום:{" "}
                  {paymentStatusLabel(
                    order.paymentStatus
                  )}
                </small>
              </strong>

              <span>
                {(order.items || []).map(
                  (item) => (
                    <span
                      key={`${item.productId}-${item.variantId || "simple"}`}
                      style={{
                        display:
                          "block",

                        marginBottom:
                          5,
                      }}
                    >
                      <b>
                        {item.name} ×
                        {item.qty}
                      </b>

                      {optionDescription(
                        item
                      ) && (
                        <small
                          style={{
                            display:
                              "block",
                          }}
                        >
                          {optionDescription(
                            item
                          )}
                        </small>
                      )}
                    </span>
                  )
                )}

                <small
                  style={{
                    display:
                      "block",

                    marginTop:
                      8,
                  }}
                >
                  לקוח:{" "}
                  {customer.name ||
                    "-"}
                </small>

                <small
                  style={{
                    display:
                      "block",
                  }}
                >
                  טלפון:{" "}
                  {customer.phone ||
                    "-"}

                  {customer.phone2
                    ? ` · ${customer.phone2}`
                    : ""}
                </small>

                <small
                  style={{
                    display:
                      "block",
                  }}
                >
                  אימייל:{" "}
                  {customer.email ||
                    "-"}
                </small>

                <small
                  style={{
                    display:
                      "block",
                  }}
                >
                  משלוח:{" "}
                  {[
                    customer.address,
                    customer.city,
                    customer.zip,
                  ]
                    .filter(Boolean)
                    .join(", ") ||
                    "-"}
                </small>
              </span>

              <strong>
                ₪ {order.total}
              </strong>

              {canWrite ? (
                <select
                  value={
                    fulfillmentStatus
                  }
                  onChange={async (
                    event
                  ) => {
                    await api.patch(
                      `/merchant/orders/${order.id}/status${qs}`,

                      {
                        fulfillmentStatus:
                          event
                            .target
                            .value,
                      },

                      opts
                    )

                    onChanged()
                  }}
                >
                  {FULFILLMENT_OPTIONS.map(
                    ([
                      value,
                      label,
                    ]) => (
                      <option
                        value={
                          value
                        }
                        key={
                          value
                        }
                      >
                        {label}
                      </option>
                    )
                  )}
                </select>
              ) : (
                <span className="order-status pending">
                  {FULFILLMENT_OPTIONS.find(
                    ([value]) =>
                      value ===
                      fulfillmentStatus
                  )?.[1] ||
                    fulfillmentStatus}
                </span>
              )}
            </div>
          )
        })}

        {orders.length ===
          0 && (
          <p>
            עדיין אין הזמנות.
          </p>
        )}
      </div>
    </section>
  )
}
// ======================================================
// PRODUCTS
// ======================================================

function productEditorId() {
  if (
    typeof crypto !== "undefined" &&
    crypto.randomUUID
  ) {
    return crypto.randomUUID()
  }

  return `tmp-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`
}

function productClean(value) {
  return String(value ?? "").trim()
}

function uniqueProductValues(values) {
  return [
    ...new Set(
      values
        .map(productClean)
        .filter(Boolean)
    ),
  ]
}

function productHttpsUrl(value) {
  try {
    return (
      new URL(value).protocol ===
      "https:"
    )
  } catch {
    return false
  }
}

function productVariantAttrs(variant) {
  return {
    model:
      productClean(
        variant?.attributes?.model
      ),

    color:
      productClean(
        variant?.attributes?.color
      ),

    size:
      productClean(
        variant?.attributes?.size
      ),
  }
}

function productVariantKey({
  model = "",
  color = "",
  size = "",
}) {
  return [
    productClean(model),
    productClean(color),
    productClean(size),
  ].join("|||")
}

function buildOptionObjectsFromVariants(
  variants,
  attribute,
  imageField
) {
  const map = new Map()

  for (const variant of variants || []) {
    const attrs =
      productVariantAttrs(
        variant
      )

    const name =
      productClean(
        attrs[attribute]
      )

    if (!name) {
      continue
    }

    if (!map.has(name)) {
      map.set(name, {
        id:
          productEditorId(),

        name,

        imageUrl:
          productClean(
            variant?.[
              imageField
            ]
          ),
      })
    } else if (
      !map.get(name)
        .imageUrl &&
      variant?.[
        imageField
      ]
    ) {
      map.get(name).imageUrl =
        productClean(
          variant[
            imageField
          ]
        )
    }
  }

  return [
    ...map.values(),
  ]
}

function buildProductVariantMatrix(
  form,
  previousVariants = []
) {
  if (
    form.inventoryMode !==
    "variants"
  ) {
    return []
  }

  const modelOptions =
    (form.models || []).filter(
      (item) =>
        productClean(
          item.name
        )
    )

  const colorOptions =
    (form.colors || []).filter(
      (item) =>
        productClean(
          item.name
        )
    )

  const sizeOptions =
    uniqueProductValues(
      form.sizes || []
    )

  const hasModels =
    modelOptions.length > 0

  const hasColors =
    colorOptions.length > 0

  const hasSizes =
    sizeOptions.length > 0

  if (
    !hasModels &&
    !hasColors &&
    !hasSizes
  ) {
    return []
  }

  const models =
    hasModels
      ? modelOptions
      : [
          {
            name: "",
            imageUrl: "",
          },
        ]

  const colors =
    hasColors
      ? colorOptions
      : [
          {
            name: "",
            imageUrl: "",
          },
        ]

  const sizes =
    hasSizes
      ? sizeOptions
      : [""]

  const previousMap =
    new Map()

  for (
    const variant of
    previousVariants || []
  ) {
    previousMap.set(
      productVariantKey(
        productVariantAttrs(
          variant
        )
      ),
      variant
    )
  }

  const result = []

  for (const model of models) {
    for (const color of colors) {
      for (const size of sizes) {
        const attributes = {
          model:
            productClean(
              model.name
            ),

          color:
            productClean(
              color.name
            ),

          size:
            productClean(
              size
            ),
        }

        const key =
          productVariantKey(
            attributes
          )

        const previous =
          previousMap.get(
            key
          )

        result.push({
          id:
            previous?.id ||
            productEditorId(),

          sku:
            previous?.sku ||
            "",

          attributes,

          modelImageUrl:
            productClean(
              model.imageUrl
            ),

          colorImageUrl:
            productClean(
              color.imageUrl
            ),

          imageUrl:
            previous?.imageUrl ||
            "",

          stockQty:
            String(
              previous
                ?.stockQty ??
                "0"
            ),

          active:
            previous?.active !==
            false,
        })
      }
    }
  }

  return result
}

function ProductsTab({
  products,
  canWrite,
  onChanged,
  isAdmin,
  storeSlug,
}) {
  const opts = {
    auth: true,

    scope:
      isAdmin
        ? "admin"
        : "merchant",
  }

  const qs =
    isAdmin &&
    storeSlug
      ? `?storeSlug=${encodeURIComponent(
          storeSlug
        )}`
      : ""

  // ====================================================
  // EMPTY FORM
  // ====================================================

  const createEmptyForm =
    () => ({
      name: "",
      brand: "",

      // מספר דגם כללי של המוצר.
      // אינו חובה.
      model: "",

      sku: "",
      barcode: "",
      category: "",
      basePrice: "",
      vatIncluded: true,
      description: "",
      badge: "",

      images: [
        {
          id:
            productEditorId(),

          url: "",

          primary:
            true,

          sortOrder:
            0,
        },
      ],

      inventoryMode:
        "simple",

      stockQty:
        "0",

      lowStockThreshold:
        "3",

      // אפשרויות בחירה
      models: [],
      colors: [],
      sizes: [],

      variants: [],

      status:
        "active",
    })

  const [
    form,
    setForm,
  ] = useState(
    createEmptyForm
  )

  const [
    editingId,
    setEditingId,
  ] = useState(null)

  const [
    productError,
    setProductError,
  ] = useState("")

  const [
    notice,
    setNotice,
  ] = useState("")

  const [
    busy,
    setBusy,
  ] = useState(false)

  const [
    search,
    setSearch,
  ] = useState("")

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("all")

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState("all")

  const [
    preview,
    setPreview,
  ] = useState(null)

  const [
    newSize,
    setNewSize,
  ] = useState("")

  const [
    newColor,
    setNewColor,
  ] = useState({
    name: "",
    imageUrl: "",
  })

  const [
    newModel,
    setNewModel,
  ] = useState({
    name: "",
    imageUrl: "",
  })

  // ====================================================
  // DERIVED
  // ====================================================

  const categories =
    useMemo(
      () =>
        uniqueProductValues(
          (products || []).map(
            (product) =>
              product.category
          )
        ).sort(
          (a, b) =>
            a.localeCompare(
              b,
              "he"
            )
        ),
      [products]
    )

  const visibleProducts =
    useMemo(() => {
      const q =
        productClean(
          search
        ).toLowerCase()

      return (
        products || []
      ).filter(
        (product) => {
          if (
            statusFilter !==
              "all" &&
            product.status !==
              statusFilter
          ) {
            return false
          }

          if (
            categoryFilter !==
              "all" &&
            product.category !==
              categoryFilter
          ) {
            return false
          }

          if (!q) {
            return true
          }

          return [
            product.name,
            product.brand,
            product.model,
            product.sku,
            product.barcode,
            product.category,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)
        }
      )
    }, [
      products,
      search,
      statusFilter,
      categoryFilter,
    ])

  const totalVariantStock =
    useMemo(
      () =>
        (form.variants || [])
          .filter(
            (variant) =>
              variant.active !==
              false
          )
          .reduce(
            (sum, variant) =>
              sum +
              Number(
                variant.stockQty ||
                  0
              ),
            0
          ),
      [form.variants]
    )

  // ====================================================
  // RESET
  // ====================================================

  const resetForm = () => {
    setForm(
      createEmptyForm()
    )

    setEditingId(null)
    setProductError("")
    setNotice("")
    setPreview(null)

    setNewSize("")

    setNewColor({
      name: "",
      imageUrl: "",
    })

    setNewModel({
      name: "",
      imageUrl: "",
    })
  }

  // ====================================================
  // GENERIC FORM UPDATE
  // ====================================================

  const updateField =
    (field) =>
    (event) => {
      const value =
        event.target
          .type ===
        "checkbox"
          ? event.target
              .checked
          : event.target
              .value

      setForm(
        (current) => ({
          ...current,

          [field]:
            value,
        })
      )
    }

  // ====================================================
  // PRICE PREVIEW
  // ====================================================

  const previewPrice =
    async (
      basePrice,
      vatIncluded
    ) => {
      if (
        basePrice === "" ||
        basePrice ===
          undefined ||
        basePrice === null
      ) {
        setPreview(null)
        return
      }

      try {
        const result =
          await api.post(
            `/merchant/pricing/preview${qs}`,

            {
              basePrice,

              vatIncluded,
            },

            opts
          )

        setPreview(
          result
        )
      } catch {
        setPreview(null)
      }
    }

  // ====================================================
  // IMAGE GALLERY
  // ====================================================

  const addProductImage =
    () => {
      setForm(
        (current) => ({
          ...current,

          images: [
            ...current.images,

            {
              id:
                productEditorId(),

              url: "",

              primary:
                current.images
                  .length === 0,

              sortOrder:
                current.images
                  .length,
            },
          ],
        })
      )
    }

  const updateProductImage =
    (
      id,
      value
    ) => {
      setForm(
        (current) => ({
          ...current,

          images:
            current.images.map(
              (image) =>
                image.id ===
                id
                  ? {
                      ...image,

                      url:
                        value,
                    }
                  : image
            ),
        })
      )
    }

  const removeProductImage =
    (id) => {
      setForm(
        (current) => {
          let images =
            current.images.filter(
              (image) =>
                image.id !==
                id
            )

          if (
            images.length ===
            0
          ) {
            images = [
              {
                id:
                  productEditorId(),

                url: "",

                primary:
                  true,

                sortOrder:
                  0,
              },
            ]
          }

          if (
            !images.some(
              (image) =>
                image.primary
            )
          ) {
            images[0] = {
              ...images[0],

              primary:
                true,
            }
          }

          images =
            images.map(
              (
                image,
                index
              ) => ({
                ...image,

                sortOrder:
                  index,
              })
            )

          return {
            ...current,

            images,
          }
        }
      )
    }

  const setPrimaryImage =
    (id) => {
      setForm(
        (current) => ({
          ...current,

          images:
            current.images.map(
              (image) => ({
                ...image,

                primary:
                  image.id ===
                  id,
              })
            ),
        })
      )
    }

  const moveProductImage =
    (
      index,
      direction
    ) => {
      setForm(
        (current) => {
          const images = [
            ...current.images,
          ]

          const target =
            index +
            direction

          if (
            target < 0 ||
            target >=
              images.length
          ) {
            return current
          }

          ;[
            images[index],
            images[target],
          ] = [
            images[target],
            images[index],
          ]

          return {
            ...current,

            images:
              images.map(
                (
                  image,
                  sortOrder
                ) => ({
                  ...image,

                  sortOrder,
                })
              ),
          }
        }
      )
    }

  // ====================================================
  // SYNC VARIANTS
  // ====================================================

  const setOptionsAndSync =
    (updater) => {
      setForm(
        (current) => {
          const next =
            typeof updater ===
            "function"
              ? updater(
                  current
                )
              : updater

          return {
            ...next,

            variants:
              buildProductVariantMatrix(
                next,
                current.variants
              ),
          }
        }
      )
    }

  // ====================================================
  // SIZES
  // ====================================================

  const addSize = () => {
    const size =
      productClean(
        newSize
      )

    if (!size) {
      return
    }

    setOptionsAndSync(
      (current) => {
        if (
          current.sizes.includes(
            size
          )
        ) {
          return current
        }

        return {
          ...current,

          inventoryMode:
            "variants",

          sizes: [
            ...current.sizes,
            size,
          ],
        }
      }
    )

    setNewSize("")
  }

  const removeSize =
    (size) => {
      setOptionsAndSync(
        (current) => ({
          ...current,

          sizes:
            current.sizes.filter(
              (item) =>
                item !==
                size
            ),
        })
      )
    }

  // ====================================================
  // COLORS
  // ====================================================

  const addColor = () => {
    const name =
      productClean(
        newColor.name
      )

    const imageUrl =
      productClean(
        newColor.imageUrl
      )

    setProductError("")

    if (!name) {
      setProductError(
        "יש להזין שם לצבע."
      )

      return
    }

    if (!imageUrl) {
      setProductError(
        `יש להוסיף תמונה לצבע "${name}".`
      )

      return
    }

    if (
      !productHttpsUrl(
        imageUrl
      )
    ) {
      setProductError(
        "תמונת הצבע חייבת להיות כתובת HTTPS תקינה."
      )

      return
    }

    if (
      form.colors.some(
        (item) =>
          productClean(
            item.name
          ).toLowerCase() ===
          name.toLowerCase()
      )
    ) {
      setProductError(
        "הצבע כבר קיים במוצר."
      )

      return
    }

    setOptionsAndSync(
      (current) => ({
        ...current,

        inventoryMode:
          "variants",

        colors: [
          ...current.colors,

          {
            id:
              productEditorId(),

            name,

            imageUrl,
          },
        ],
      })
    )

    setNewColor({
      name: "",
      imageUrl: "",
    })
  }

  const removeColor =
    (id) => {
      setOptionsAndSync(
        (current) => ({
          ...current,

          colors:
            current.colors.filter(
              (item) =>
                item.id !==
                id
            ),
        })
      )
    }

  const updateColorImage =
    (
      id,
      imageUrl
    ) => {
      setOptionsAndSync(
        (current) => ({
          ...current,

          colors:
            current.colors.map(
              (item) =>
                item.id === id
                  ? {
                      ...item,

                      imageUrl,
                    }
                  : item
            ),
        })
      )
    }

  // ====================================================
  // SELECTABLE MODELS
  // ====================================================

  const addSelectableModel =
    () => {
      const name =
        productClean(
          newModel.name
        )

      const imageUrl =
        productClean(
          newModel.imageUrl
        )

      setProductError("")

      if (!name) {
        setProductError(
          "יש להזין שם לדגם."
        )

        return
      }

      if (!imageUrl) {
        setProductError(
          `יש להוסיף תמונה לדגם "${name}".`
        )

        return
      }

      if (
        !productHttpsUrl(
          imageUrl
        )
      ) {
        setProductError(
          "תמונת הדגם חייבת להיות כתובת HTTPS תקינה."
      )

      return
    }

    if (
      form.models.some(
        (item) =>
          productClean(
            item.name
          ).toLowerCase() ===
          name.toLowerCase()
      )
    ) {
      setProductError(
        "הדגם כבר קיים במוצר."
      )

      return
    }

    setOptionsAndSync(
      (current) => ({
        ...current,

        inventoryMode:
          "variants",

        models: [
          ...current.models,

          {
            id:
              productEditorId(),

            name,

            imageUrl,
          },
        ],
      })
    )

    setNewModel({
      name: "",
      imageUrl: "",
    })
  }

  const removeSelectableModel =
    (id) => {
      setOptionsAndSync(
        (current) => ({
          ...current,

          models:
            current.models.filter(
              (item) =>
                item.id !==
                id
            ),
        })
      )
    }

  const updateModelImage =
    (
      id,
      imageUrl
    ) => {
      setOptionsAndSync(
        (current) => ({
          ...current,

          models:
            current.models.map(
              (item) =>
                item.id === id
                  ? {
                      ...item,

                      imageUrl,
                    }
                  : item
            ),
        })
      )
    }

  // ====================================================
  // VARIANT UPDATE
  // ====================================================

  const updateVariant =
    (
      id,
      patch
    ) => {
      setForm(
        (current) => ({
          ...current,

          variants:
            current.variants.map(
              (variant) =>
                variant.id === id
                  ? {
                      ...variant,
                      ...patch,
                    }
                  : variant
            ),
        })
      )
    }

  // ====================================================
  // INVENTORY MODE
  // ====================================================

  const changeInventoryMode =
    (event) => {
      const mode =
        event.target.value

      setForm(
        (current) => {
          const next = {
            ...current,

            inventoryMode:
              mode,
          }

          return {
            ...next,

            variants:
              mode ===
              "variants"
                ? buildProductVariantMatrix(
                    next,
                    current.variants
                  )
                : [],
          }
        }
      )
    }

  // ====================================================
  // VALIDATION
  // ====================================================

  const validateProduct =
    (payload) => {
      if (!payload.name) {
        return "יש להזין שם מוצר."
      }

      if (
        !payload.category
      ) {
        return "יש לבחור או ליצור קטגוריה."
      }

      if (
        !Number.isFinite(
          payload.basePrice
        ) ||
        payload.basePrice <
          0
      ) {
        return "מחיר המוצר אינו תקין."
      }

      if (
        payload.images.length ===
        0
      ) {
        return "יש להוסיף לפחות תמונת מוצר אחת."
      }

      if (
        payload.images.some(
          (image) =>
            !productHttpsUrl(
              image.url
            )
        )
      ) {
        return "כל תמונת מוצר חייבת להיות כתובת HTTPS תקינה."
      }

      for (
        const color of
        form.colors
      ) {
        if (
          !productClean(
            color.name
          )
        ) {
          return "לכל צבע חייב להיות שם."
        }

        if (
          !productClean(
            color.imageUrl
          )
        ) {
          return `יש להוסיף תמונה לצבע ${color.name}.`
        }

        if (
          !productHttpsUrl(
            color.imageUrl
          )
        ) {
          return `התמונה של הצבע ${color.name} אינה כתובת HTTPS תקינה.`
        }
      }

      for (
        const model of
        form.models
      ) {
        if (
          !productClean(
            model.name
          )
        ) {
          return "לכל דגם לבחירה חייב להיות שם."
        }

        if (
          !productClean(
            model.imageUrl
          )
        ) {
          return `יש להוסיף תמונה לדגם ${model.name}.`
        }

        if (
          !productHttpsUrl(
            model.imageUrl
          )
        ) {
          return `התמונה של הדגם ${model.name} אינה כתובת HTTPS תקינה.`
        }
      }

      if (
        payload.inventoryMode ===
          "variants" &&
        payload.variants.length ===
          0
      ) {
        return "בניהול מלאי לפי אפשרויות יש להוסיף לפחות מידה, צבע או דגם לבחירה."
      }

      if (
        payload.variants.some(
          (variant) =>
            !Number.isFinite(
              Number(
                variant.stockQty
              )
            ) ||
            Number(
              variant.stockQty
            ) < 0
        )
      ) {
        return "כמות המלאי באחת האפשרויות אינה תקינה."
      }

      return ""
    }

  // ====================================================
  // FORM -> API
  // ====================================================

  const normalizeFormForApi =
    () => {
      const images =
        (form.images || [])
          .map(
            (
              image,
              index
            ) => ({
              id:
                image.id,

              url:
                productClean(
                  image.url
                ),

              primary:
                image.primary ===
                true,

              sortOrder:
                index,
            })
          )
          .filter(
            (image) =>
              image.url
          )

      const variants =
        form.inventoryMode ===
        "variants"
          ? buildProductVariantMatrix(
              form,
              form.variants
            ).map(
              (variant) => ({
                id:
                  variant.id,

                sku:
                  productClean(
                    variant.sku
                  ),

                attributes: {
                  model:
                    productClean(
                      variant
                        .attributes
                        .model
                    ),

                  color:
                    productClean(
                      variant
                        .attributes
                        .color
                    ),

                  size:
                    productClean(
                      variant
                        .attributes
                        .size
                    ),
                },

                modelImageUrl:
                  productClean(
                    variant.modelImageUrl
                  ),

                colorImageUrl:
                  productClean(
                    variant.colorImageUrl
                  ),

                imageUrl:
                  productClean(
                    variant.imageUrl
                  ),

                stockQty:
                  Number(
                    variant.stockQty ||
                      0
                  ),

                active:
                  variant.active !==
                  false,
              })
            )
          : []

      return {
        name:
          productClean(
            form.name
          ),

        brand:
          productClean(
            form.brand
          ),

        // אופציונלי
        model:
          productClean(
            form.model
          ),

        sku:
          productClean(
            form.sku
          ),

        barcode:
          productClean(
            form.barcode
          ),

        category:
          productClean(
            form.category
          ),

        basePrice:
          Number(
            form.basePrice
          ),

        vatIncluded:
          form.vatIncluded ===
          true,

        description:
          productClean(
            form.description
          ),

        badge:
          productClean(
            form.badge
          ),

        images,

        imageUrl:
          images.find(
            (image) =>
              image.primary
          )?.url ||
          images[0]?.url ||
          "",

        hasSizes:
          form.sizes.length >
          0,

        sizes:
          uniqueProductValues(
            form.sizes
          ),

        inventoryMode:
          form.inventoryMode,

        stockQty:
          form.inventoryMode ===
          "simple"
            ? Number(
                form.stockQty ||
                  0
              )
            : 0,

        lowStockThreshold:
          Number(
            form.lowStockThreshold ||
              0
          ),

        variants,

        status:
          form.status,
      }
    }

  // ====================================================
  // SAVE
  // ====================================================

  const saveProduct =
    async (event) => {
      event.preventDefault()

      if (!canWrite) {
        return
      }

      setProductError("")
      setNotice("")

      const payload =
        normalizeFormForApi()

      const validationError =
        validateProduct(
          payload
        )

      if (
        validationError
      ) {
        setProductError(
          validationError
        )

        return
      }

      setBusy(true)

      try {
        if (editingId) {
          await api.patch(
            `/merchant/products/${editingId}${qs}`,
            payload,
            opts
          )

          setNotice(
            "המוצר עודכן בהצלחה."
          )
        } else {
          await api.post(
            `/merchant/products${qs}`,
            payload,
            opts
          )

          setNotice(
            "המוצר נוסף בהצלחה."
          )
        }

        if (onChanged) {
          await onChanged()
        }

        resetForm()
      } catch (error) {
        setProductError(
          error?.message ||
            "שמירת המוצר נכשלה"
        )
      } finally {
        setBusy(false)
      }
    }

  // ====================================================
  // EDIT
  // ====================================================

  const editProduct =
    (product) => {
      const rawVariants =
        Array.isArray(
          product.variants
        )
          ? product.variants
          : []

      const models =
        buildOptionObjectsFromVariants(
          rawVariants,
          "model",
          "modelImageUrl"
        )

      const colors =
        buildOptionObjectsFromVariants(
          rawVariants,
          "color",
          "colorImageUrl"
        )

      const variantSizes =
        uniqueProductValues(
          rawVariants.map(
            (variant) =>
              productVariantAttrs(
                variant
              ).size
          )
        )

      const sizes =
        variantSizes.length
          ? variantSizes
          : uniqueProductValues(
              product.sizes ||
                []
            )

      let images =
        Array.isArray(
          product.images
        ) &&
        product.images.length
          ? product.images.map(
              (
                image,
                index
              ) => ({
                id:
                  image.id ||
                  productEditorId(),

                url:
                  image.url ||
                  "",

                primary:
                  image.primary ===
                  true,

                sortOrder:
                  index,
              })
            )
          : [
              {
                id:
                  productEditorId(),

                url:
                  product.imageUrl ||
                  "",

                primary:
                  true,

                sortOrder:
                  0,
              },
            ]

      if (
        images.length &&
        !images.some(
          (image) =>
            image.primary
        )
      ) {
        images[0].primary =
          true
      }

      const nextForm = {
        name:
          product.name ||
          "",

        brand:
          product.brand ||
          "",

        model:
          product.model ||
          "",

        sku:
          product.sku ||
          "",

        barcode:
          product.barcode ||
          "",

        category:
          product.category ||
          "",

        basePrice:
          String(
            product.basePrice ??
              ""
          ),

        vatIncluded:
          product.vatIncluded ===
          true,

        description:
          product.description ||
          "",

        badge:
          product.badge ||
          "",

        images,

        inventoryMode:
          product.inventoryMode ||
          (
            rawVariants.length
              ? "variants"
              : "simple"
          ),

        stockQty:
          String(
            product.stockQty ??
              0
          ),

        lowStockThreshold:
          String(
            product.lowStockThreshold ??
              3
          ),

        models,

        colors,

        sizes,

        variants:
          rawVariants.map(
            (variant) => ({
              id:
                variant.id ||
                productEditorId(),

              sku:
                variant.sku ||
                "",

              attributes:
                productVariantAttrs(
                  variant
                ),

              modelImageUrl:
                variant.modelImageUrl ||
                "",

              colorImageUrl:
                variant.colorImageUrl ||
                "",

              imageUrl:
                variant.imageUrl ||
                "",

              stockQty:
                String(
                  variant.stockQty ??
                    0
                ),

              active:
                variant.active !==
                false,
            })
          ),

        status:
          product.status ||
          "active",
      }

      nextForm.variants =
        buildProductVariantMatrix(
          nextForm,
          nextForm.variants
        )

      setForm(
        nextForm
      )

      setEditingId(
        product.id
      )

      setProductError("")
      setNotice("")

      previewPrice(
        nextForm.basePrice,
        nextForm.vatIncluded
      )

      window.scrollTo({
        top: 0,

        behavior:
          "smooth",
      })
    }

  // ====================================================
  // DUPLICATE
  // ====================================================

  const duplicateProduct =
    async (id) => {
      if (!canWrite) {
        return
      }

      setBusy(true)
      setProductError("")

      try {
        await api.post(
          `/merchant/products/${id}/duplicate${qs}`,
          {},
          opts
        )

        if (onChanged) {
          await onChanged()
        }

        setNotice(
          "נוצר עותק של המוצר כטיוטה."
        )
      } catch (error) {
        setProductError(
          error?.message ||
            "שכפול המוצר נכשל"
        )
      } finally {
        setBusy(false)
      }
    }

  // ====================================================
  // STATUS
  // ====================================================

  const setProductStatus =
    async (
      product,
      status
    ) => {
      if (!canWrite) {
        return
      }

      setBusy(true)
      setProductError("")

      try {
        await api.patch(
          `/merchant/products/${product.id}${qs}`,

          {
            status,
          },

          opts
        )

        if (onChanged) {
          await onChanged()
        }
      } catch (error) {
        setProductError(
          error?.message ||
            "עדכון הסטטוס נכשל"
        )
      } finally {
        setBusy(false)
      }
    }

  // ====================================================
  // DELETE
  // ====================================================

  const deleteProduct =
    async (product) => {
      if (!canWrite) {
        return
      }

      const approved =
        window.confirm(
          `למחוק לצמיתות את "${product.name}"?`
        )

      if (!approved) {
        return
      }

      setBusy(true)
      setProductError("")

      try {
        await api.delete(
          `/merchant/products/${product.id}${qs}`,
          opts
        )

        if (
          editingId ===
          product.id
        ) {
          resetForm()
        }

        if (onChanged) {
          await onChanged()
        }
      } catch (error) {
        setProductError(
          error?.message ||
            "מחיקת המוצר נכשלה"
        )
      } finally {
        setBusy(false)
      }
    }

  // ====================================================
  // UI
  // ====================================================

  return (
    <div className="crm-stack">
      <section className="crm-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              ניהול מוצרים
            </p>

            <h2>
              {editingId
                ? "עריכת מוצר"
                : "הוספת מוצר"}
            </h2>
          </div>

          {editingId && (
            <button
              type="button"
              className="text-link"
              onClick={
                resetForm
              }
            >
              ביטול עריכה
            </button>
          )}
        </div>

        {productError && (
          <p className="form-error">
            {productError}
          </p>
        )}

        {notice && (
          <p className="coupon-note">
            {notice}
          </p>
        )}

        <form
          onSubmit={
            saveProduct
          }
        >
          <div className="form-grid">
            <label>
              שם מוצר *

              <input
                required
                value={
                  form.name
                }
                onChange={
                  updateField(
                    "name"
                  )
                }
              />
            </label>

            <label>
              מותג

              <input
                value={
                  form.brand
                }
                onChange={
                  updateField(
                    "brand"
                  )
                }
              />
            </label>

            <label>
              מספר דגם כללי{" "}
              <small>
                (אופציונלי)
              </small>

              <input
                value={
                  form.model
                }
                onChange={
                  updateField(
                    "model"
                  )
                }
                placeholder="לדוגמה SM-X210"
              />
            </label>

            <label>
              SKU כללי

              <input
                value={
                  form.sku
                }
                onChange={
                  updateField(
                    "sku"
                  )
                }
              />
            </label>

            <label>
              ברקוד

              <input
                value={
                  form.barcode
                }
                onChange={
                  updateField(
                    "barcode"
                  )
                }
              />
            </label>

            <label>
              קטגוריה *

              <input
                required
                list="merchant-product-categories"
                value={
                  form.category
                }
                onChange={
                  updateField(
                    "category"
                  )
                }
                placeholder="אפשר לכתוב קטגוריה חדשה"
              />

              <datalist id="merchant-product-categories">
                {categories.map(
                  (category) => (
                    <option
                      key={
                        category
                      }
                      value={
                        category
                      }
                    />
                  )
                )}
              </datalist>
            </label>

            <label>
              מחיר בסיס *

              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={
                  form.basePrice
                }
                onChange={(
                  event
                ) => {
                  const value =
                    event.target
                      .value

                  setForm(
                    (current) => ({
                      ...current,

                      basePrice:
                        value,
                    })
                  )

                  previewPrice(
                    value,
                    form.vatIncluded
                  )
                }}
              />
            </label>

            <label>
              סטטוס

              <select
                value={
                  form.status
                }
                onChange={
                  updateField(
                    "status"
                  )
                }
              >
                <option value="active">
                  פעיל
                </option>

                <option value="draft">
                  טיוטה
                </option>

                <option value="archived">
                  בארכיון
                </option>
              </select>
            </label>

            <label>
              סף מלאי נמוך

              <input
                type="number"
                min="0"
                value={
                  form.lowStockThreshold
                }
                onChange={
                  updateField(
                    "lowStockThreshold"
                  )
                }
              />
            </label>

            <label>
              תגית

              <input
                value={
                  form.badge
                }
                onChange={
                  updateField(
                    "badge"
                  )
                }
                placeholder="חדש / מבצע"
              />
            </label>

            <label>
              <span className="field-label">
                <input
                  type="checkbox"
                  checked={
                    form.vatIncluded
                  }
                  onChange={(
                    event
                  ) => {
                    const checked =
                      event.target
                        .checked

                    setForm(
                      (current) => ({
                        ...current,

                        vatIncluded:
                          checked,
                      })
                    )

                    previewPrice(
                      form.basePrice,
                      checked
                    )
                  }}
                />

                המחיר כולל מע״מ
              </span>
            </label>

            <label className="wide">
              תיאור

              <textarea
                rows="4"
                value={
                  form.description
                }
                onChange={
                  updateField(
                    "description"
                  )
                }
              />
            </label>
          </div>

          {preview && (
            <div className="checkout-note">
              מחיר לצרכן:{" "}
              <strong>
                ₪
                {
                  preview.consumerPrice
                }
              </strong>
            </div>
          )}

          <hr />

          {/* =============================================
              PRODUCT IMAGES
          ============================================= */}

          <div className="section-heading">
            <div>
              <p className="eyebrow">
                גלריה
              </p>

              <h3>
                תמונות המוצר
              </h3>
            </div>

            <button
              type="button"
              className="text-link"
              onClick={
                addProductImage
              }
            >
              + הוספת תמונה
            </button>
          </div>

          <div
            style={{
              display:
                "grid",

              gap:
                12,
            }}
          >
            {form.images.map(
              (
                image,
                index
              ) => (
                <div
                  key={
                    image.id
                  }
                  className="crm-panel"
                  style={{
                    padding:
                      14,
                  }}
                >
                  <div
                    style={{
                      display:
                        "grid",

                      gridTemplateColumns:
                        "90px 1fr",

                      gap:
                        14,

                      alignItems:
                        "center",
                    }}
                  >
                    <div
                      style={{
                        width:
                          90,

                        height:
                          90,

                        border:
                          "1px solid #ddd",

                        borderRadius:
                          10,

                        overflow:
                          "hidden",

                        display:
                          "grid",

                        placeItems:
                          "center",
                      }}
                    >
                      {image.url ? (
                        <img
                          src={
                            image.url
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
                      ) : (
                        <small>
                          תצוגה
                        </small>
                      )}
                    </div>

                    <div>
                      <input
                        placeholder="https://..."
                        value={
                          image.url
                        }
                        onChange={(
                          event
                        ) =>
                          updateProductImage(
                            image.id,
                            event
                              .target
                              .value
                          )
                        }
                      />

                      <div
                        style={{
                          display:
                            "flex",

                          flexWrap:
                            "wrap",

                          gap:
                            8,

                          marginTop:
                            8,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setPrimaryImage(
                              image.id
                            )
                          }
                        >
                          {image.primary
                            ? "✓ תמונה ראשית"
                            : "הגדר כראשית"}
                        </button>

                        <button
                          type="button"
                          disabled={
                            index ===
                            0
                          }
                          onClick={() =>
                            moveProductImage(
                              index,
                              -1
                            )
                          }
                        >
                          ↑
                        </button>

                        <button
                          type="button"
                          disabled={
                            index ===
                            form.images
                              .length -
                              1
                          }
                          onClick={() =>
                            moveProductImage(
                              index,
                              1
                            )
                          }
                        >
                          ↓
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            removeProductImage(
                              image.id
                            )
                          }
                        >
                          הסרה
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          <hr />

          {/* =============================================
              INVENTORY
          ============================================= */}

          <div className="section-heading">
            <div>
              <p className="eyebrow">
                מלאי ואפשרויות
              </p>

              <h3>
                איך הלקוח בוחר את המוצר?
              </h3>
            </div>
          </div>

          <div className="form-grid">
            <label>
              ניהול מלאי

              <select
                value={
                  form.inventoryMode
                }
                onChange={
                  changeInventoryMode
                }
              >
                <option value="simple">
                  מוצר פשוט
                </option>

                <option value="variants">
                  מידות / צבעים / דגמים
                </option>
              </select>
            </label>

            {form.inventoryMode ===
              "simple" && (
              <label>
                מלאי כללי

                <input
                  type="number"
                  min="0"
                  value={
                    form.stockQty
                  }
                  onChange={
                    updateField(
                      "stockQty"
                    )
                  }
                />
              </label>
            )}
          </div>

          {form.inventoryMode ===
            "variants" && (
            <>
              {/* =========================================
                  COLORS
              ========================================= */}

              <div
                className="crm-panel"
                style={{
                  marginTop:
                    16,
                }}
              >
                <h3>
                  צבעים
                </h3>

                <p className="checkout-note">
                  לכל צבע מוסיפים
                  תמונה פעם אחת.
                  התמונה תשמש את כל
                  המידות של אותו צבע.
                </p>

                <div className="form-grid">
                  <label>
                    שם צבע

                    <input
                      value={
                        newColor.name
                      }
                      onChange={(
                        event
                      ) =>
                        setNewColor(
                          (current) => ({
                            ...current,

                            name:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="שחור"
                    />
                  </label>

                  <label>
                    תמונת הצבע

                    <input
                      value={
                        newColor.imageUrl
                      }
                      onChange={(
                        event
                      ) =>
                        setNewColor(
                          (current) => ({
                            ...current,

                            imageUrl:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="https://..."
                    />
                  </label>
                </div>

                {newColor.imageUrl && (
                  <ProductOptionPreview
                    url={
                      newColor.imageUrl
                    }
                    label={
                      newColor.name ||
                      "צבע חדש"
                    }
                  />
                )}

                <button
                  type="button"
                  onClick={
                    addColor
                  }
                >
                  + הוספת צבע
                </button>

                <div
                  style={{
                    display:
                      "flex",

                    flexWrap:
                      "wrap",

                    gap:
                      12,

                    marginTop:
                      15,
                  }}
                >
                  {form.colors.map(
                    (color) => (
                      <div
                        key={
                          color.id
                        }
                        className="crm-panel"
                        style={{
                          width:
                            190,
                        }}
                      >
                        <ProductOptionPreview
                          url={
                            color.imageUrl
                          }
                          label={
                            color.name
                          }
                        />

                        <strong>
                          {
                            color.name
                          }
                        </strong>

                        <input
                          value={
                            color.imageUrl
                          }
                          onChange={(
                            event
                          ) =>
                            updateColorImage(
                              color.id,
                              event
                                .target
                                .value
                            )
                          }
                        />

                        <button
                          type="button"
                          onClick={() =>
                            removeColor(
                              color.id
                            )
                          }
                        >
                          הסרת צבע
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* =========================================
                  SIZES
              ========================================= */}

              <div
                className="crm-panel"
                style={{
                  marginTop:
                    16,
                }}
              >
                <h3>
                  מידות
                </h3>

                <p className="checkout-note">
                  כל מידה מתווספת
                  בנפרד. לדוגמה:
                  41, אחר כך 42,
                  אחר כך 43.
                </p>

                <div
                  style={{
                    display:
                      "flex",

                    gap:
                      8,

                    flexWrap:
                      "wrap",
                  }}
                >
                  <input
                    value={
                      newSize
                    }
                    onChange={(
                      event
                    ) =>
                      setNewSize(
                        event
                          .target
                          .value
                      )
                    }
                    onKeyDown={(
                      event
                    ) => {
                      if (
                        event.key ===
                        "Enter"
                      ) {
                        event.preventDefault()
                        addSize()
                      }
                    }}
                    placeholder="41"
                    style={{
                      maxWidth:
                        180,
                    }}
                  />

                  <button
                    type="button"
                    onClick={
                      addSize
                    }
                  >
                    + הוספת מידה
                  </button>
                </div>

                <div
                  style={{
                    display:
                      "flex",

                    flexWrap:
                      "wrap",

                    gap:
                      8,

                    marginTop:
                      12,
                  }}
                >
                  {form.sizes.map(
                    (size) => (
                      <button
                        type="button"
                        key={
                          size
                        }
                        onClick={() =>
                          removeSize(
                            size
                          )
                        }
                        title="לחץ להסרה"
                        style={{
                          padding:
                            "9px 14px",
                        }}
                      >
                        {size} ×
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* =========================================
                  OPTIONAL MODELS
              ========================================= */}

              <div
                className="crm-panel"
                style={{
                  marginTop:
                    16,
                }}
              >
                <h3>
                  דגמים לבחירה{" "}
                  <small>
                    (אופציונלי)
                  </small>
                </h3>

                <p className="checkout-note">
                  אם למוצר אין דגמים
                  לבחירה, משאירים את
                  החלק הזה ריק. צבעים
                  ומידות יעבדו גם בלי
                  דגם.
                </p>

                <div className="form-grid">
                  <label>
                    שם דגם

                    <input
                      value={
                        newModel.name
                      }
                      onChange={(
                        event
                      ) =>
                        setNewModel(
                          (current) => ({
                            ...current,

                            name:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="Pro / Classic / דגם A"
                    />
                  </label>

                  <label>
                    תמונת הדגם

                    <input
                      value={
                        newModel.imageUrl
                      }
                      onChange={(
                        event
                      ) =>
                        setNewModel(
                          (current) => ({
                            ...current,

                            imageUrl:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="https://..."
                    />
                  </label>
                </div>

                {newModel.imageUrl && (
                  <ProductOptionPreview
                    url={
                      newModel.imageUrl
                    }
                    label={
                      newModel.name ||
                      "דגם חדש"
                    }
                  />
                )}

                <button
                  type="button"
                  onClick={
                    addSelectableModel
                  }
                >
                  + הוספת דגם
                </button>

                <div
                  style={{
                    display:
                      "flex",

                    flexWrap:
                      "wrap",

                    gap:
                      12,

                    marginTop:
                      15,
                  }}
                >
                  {form.models.map(
                    (model) => (
                      <div
                        key={
                          model.id
                        }
                        className="crm-panel"
                        style={{
                          width:
                            190,
                        }}
                      >
                        <ProductOptionPreview
                          url={
                            model.imageUrl
                          }
                          label={
                            model.name
                          }
                        />

                        <strong>
                          {
                            model.name
                          }
                        </strong>

                        <input
                          value={
                            model.imageUrl
                          }
                          onChange={(
                            event
                          ) =>
                            updateModelImage(
                              model.id,
                              event
                                .target
                                .value
                            )
                          }
                        />

                        <button
                          type="button"
                          onClick={() =>
                            removeSelectableModel(
                              model.id
                            )
                          }
                        >
                          הסרת דגם
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* =========================================
                  GENERATED MATRIX
              ========================================= */}

              <div
                className="crm-panel"
                style={{
                  marginTop:
                    16,
                }}
              >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">
                      שילובים שנוצרו
                      אוטומטית
                    </p>

                    <h3>
                      מלאי לפי בחירה
                    </h3>
                  </div>

                  <strong>
                    מלאי כולל:{" "}
                    {
                      totalVariantStock
                    }
                  </strong>
                </div>

                {form.variants.length ===
                0 ? (
                  <p className="checkout-note">
                    הוסף לפחות צבע,
                    מידה או דגם.
                  </p>
                ) : (
                  <div
                    style={{
                      overflowX:
                        "auto",
                    }}
                  >
                    <table
                      style={{
                        width:
                          "100%",

                        borderCollapse:
                          "collapse",
                      }}
                    >
                      <thead>
                        <tr>
                          {form.models
                            .length >
                            0 && (
                            <th>
                              דגם
                            </th>
                          )}

                          {form.colors
                            .length >
                            0 && (
                            <th>
                              צבע
                            </th>
                          )}

                          {form.sizes
                            .length >
                            0 && (
                            <th>
                              מידה
                            </th>
                          )}

                          <th>
                            תמונה
                          </th>

                          <th>
                            SKU
                          </th>

                          <th>
                            מלאי
                          </th>

                          <th>
                            פעיל
                          </th>

                          <th>
                            תמונה מיוחדת
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {form.variants.map(
                          (
                            variant
                          ) => {
                            const attrs =
                              productVariantAttrs(
                                variant
                              )

                            const previewUrl =
                              variant.imageUrl ||
                              variant.colorImageUrl ||
                              variant.modelImageUrl ||
                              ""

                            return (
                              <tr
                                key={
                                  variant.id
                                }
                              >
                                {form.models
                                  .length >
                                  0 && (
                                  <td>
                                    {
                                      attrs.model
                                    }
                                  </td>
                                )}

                                {form.colors
                                  .length >
                                  0 && (
                                  <td>
                                    {
                                      attrs.color
                                    }
                                  </td>
                                )}

                                {form.sizes
                                  .length >
                                  0 && (
                                  <td>
                                    {
                                      attrs.size
                                    }
                                  </td>
                                )}

                                <td>
                                  {previewUrl ? (
                                    <img
                                      src={
                                        previewUrl
                                      }
                                      alt=""
                                      style={{
                                        width:
                                          48,

                                        height:
                                          48,

                                        objectFit:
                                          "cover",

                                        borderRadius:
                                          8,
                                      }}
                                    />
                                  ) : (
                                    "—"
                                  )}
                                </td>

                                <td>
                                  <input
                                    value={
                                      variant.sku
                                    }
                                    onChange={(
                                      event
                                    ) =>
                                      updateVariant(
                                        variant.id,
                                        {
                                          sku:
                                            event
                                              .target
                                              .value,
                                        }
                                      )
                                    }
                                    style={{
                                      minWidth:
                                        110,
                                    }}
                                  />
                                </td>

                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    value={
                                      variant.stockQty
                                    }
                                    onChange={(
                                      event
                                    ) =>
                                      updateVariant(
                                        variant.id,
                                        {
                                          stockQty:
                                            event
                                              .target
                                              .value,
                                        }
                                      )
                                    }
                                    style={{
                                      width:
                                        85,
                                    }}
                                  />
                                </td>

                                <td>
                                  <input
                                    type="checkbox"
                                    checked={
                                      variant.active !==
                                      false
                                    }
                                    onChange={(
                                      event
                                    ) =>
                                      updateVariant(
                                        variant.id,
                                        {
                                          active:
                                            event
                                              .target
                                              .checked,
                                        }
                                      )
                                    }
                                  />
                                </td>

                                <td>
                                  <input
                                    value={
                                      variant.imageUrl ||
                                      ""
                                    }
                                    onChange={(
                                      event
                                    ) =>
                                      updateVariant(
                                        variant.id,
                                        {
                                          imageUrl:
                                            event
                                              .target
                                              .value,
                                        }
                                      )
                                    }
                                    placeholder="אופציונלי"
                                    style={{
                                      minWidth:
                                        180,
                                    }}
                                  />
                                </td>
                              </tr>
                            )
                          }
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          <div
            style={{
              display:
                "flex",

              gap:
                10,

              marginTop:
                20,

              flexWrap:
                "wrap",
            }}
          >
            <button
              className="checkout-button"
              disabled={
                !canWrite ||
                busy
              }
              type="submit"
            >
              {busy
                ? "שומר..."
                : editingId
                ? "שמירת השינויים"
                : "יצירת המוצר"}
            </button>

            {editingId && (
              <button
                type="button"
                onClick={
                  resetForm
                }
              >
                ביטול
              </button>
            )}
          </div>
        </form>
      </section>

      {/* =================================================
          PRODUCT LIST
      ================================================= */}

      <section className="crm-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              קטלוג החנות
            </p>

            <h2>
              מוצרים
            </h2>
          </div>

          <strong>
            {
              visibleProducts.length
            }{" "}
            מוצרים
          </strong>
        </div>

        <div className="toolbar">
          <div className="search-box">
            <span>
              🔎
            </span>

            <input
              value={
                search
              }
              onChange={(
                event
              ) =>
                setSearch(
                  event
                    .target
                    .value
                )
              }
              placeholder="חיפוש מוצר"
            />
          </div>

          <select
            value={
              statusFilter
            }
            onChange={(
              event
            ) =>
              setStatusFilter(
                event.target
                  .value
              )
            }
          >
            <option value="all">
              כל הסטטוסים
            </option>

            <option value="active">
              פעילים
            </option>

            <option value="draft">
              טיוטות
            </option>

            <option value="archived">
              ארכיון
            </option>
          </select>

          <select
            value={
              categoryFilter
            }
            onChange={(
              event
            ) =>
              setCategoryFilter(
                event.target
                  .value
              )
            }
          >
            <option value="all">
              כל הקטגוריות
            </option>

            {categories.map(
              (category) => (
                <option
                  key={
                    category
                  }
                  value={
                    category
                  }
                >
                  {category}
                </option>
              )
            )}
          </select>
        </div>

        {visibleProducts.length ===
        0 ? (
          <p>
            לא נמצאו מוצרים.
          </p>
        ) : (
          <div
            style={{
              display:
                "grid",

              gap:
                12,
            }}
          >
            {visibleProducts.map(
              (product) => {
                const variantStock =
                  (
                    product.variants ||
                    []
                  ).reduce(
                    (
                      sum,
                      variant
                    ) =>
                      sum +
                      Number(
                        variant.stockQty ||
                          0
                      ),
                    0
                  )

                const stock =
                  product.inventoryMode ===
                  "variants"
                    ? variantStock
                    : Number(
                        product.stockQty ||
                          0
                      )

                return (
                  <article
                    key={
                      product.id
                    }
                    className="crm-panel"
                    style={{
                      padding:
                        14,
                    }}
                  >
                    <div
                      style={{
                        display:
                          "grid",

                        gridTemplateColumns:
                          "90px 1fr",

                        gap:
                          14,
                      }}
                    >
                      <div
                        style={{
                          width:
                            90,

                          height:
                            90,

                          borderRadius:
                            10,

                          overflow:
                            "hidden",

                          background:
                            "#f3f3f3",
                        }}
                      >
                        {product.imageUrl && (
                          <img
                            src={
                              product.imageUrl
                            }
                            alt={
                              product.name
                            }
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
                        <div
                          style={{
                            display:
                              "flex",

                            justifyContent:
                              "space-between",

                            gap:
                              10,

                            flexWrap:
                              "wrap",
                          }}
                        >
                          <div>
                            <strong>
                              {
                                product.name
                              }
                            </strong>

                            <div>
                              {
                                product.category
                              }

                              {product.brand
                                ? ` · ${product.brand}`
                                : ""}

                              {product.model
                                ? ` · ${product.model}`
                                : ""}
                            </div>

                            <small>
                              מלאי:{" "}
                              {stock}
                              {" · "}
                              {
                                product.status
                              }
                            </small>
                          </div>

                          <strong>
                            ₪
                            {
                              product.basePrice
                            }
                          </strong>
                        </div>

                        <div
                          style={{
                            display:
                              "flex",

                            gap:
                              7,

                            flexWrap:
                              "wrap",

                            marginTop:
                              10,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              editProduct(
                                product
                              )
                            }
                          >
                            עריכה
                          </button>

                          <button
                            type="button"
                            disabled={
                              !canWrite ||
                              busy
                            }
                            onClick={() =>
                              duplicateProduct(
                                product.id
                              )
                            }
                          >
                            שכפול
                          </button>

                          {product.status !==
                            "active" && (
                            <button
                              type="button"
                              disabled={
                                !canWrite ||
                                busy
                              }
                              onClick={() =>
                                setProductStatus(
                                  product,
                                  "active"
                                )
                              }
                            >
                              הפעלה
                            </button>
                          )}

                          {product.status !==
                            "archived" && (
                            <button
                              type="button"
                              disabled={
                                !canWrite ||
                                busy
                              }
                              onClick={() =>
                                setProductStatus(
                                  product,
                                  "archived"
                                )
                              }
                            >
                              ארכוב
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={
                              !canWrite ||
                              busy
                            }
                            onClick={() =>
                              deleteProduct(
                                product
                              )
                            }
                          >
                            מחיקה
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              }
            )}
          </div>
        )}
      </section>
    </div>
  )
}

// ======================================================
// OPTION PREVIEW
// ======================================================

function ProductOptionPreview({
  url,
  label,
}) {
  return (
    <div
      style={{
        width:
          100,

        marginBottom:
          8,
      }}
    >
      <div
        style={{
          width:
            82,

          height:
            82,

          borderRadius:
            10,

          overflow:
            "hidden",

          border:
            "1px solid #ddd",

          display:
            "grid",

          placeItems:
            "center",

          background:
            "#fafafa",
        }}
      >
        {url ? (
          <img
            src={
              url
            }
            alt={
              label || ""
            }
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
          <small>
            ללא תמונה
          </small>
        )}
      </div>
    </div>
  )
}
function WalletTab({
  wallet,
  canWrite,
  canRefund,
  onChanged,
  isAdmin,
  storeSlug,
}) {
  const opts = {
    auth: true,

    scope:
      isAdmin
        ? "admin"
        : "merchant",
  }

  const qs =
    isAdmin &&
    storeSlug
      ? `?storeSlug=${encodeURIComponent(
          storeSlug
        )}`
      : ""

  const [
    refundForm,
    setRefundForm,
  ] = useState({
    orderId: "",
    amount: "",
    reason: "",
  })

  const requestPayout =
    async () => {
      await api.post(
        `/merchant/wallet/payout-request${qs}`,
        {},
        opts
      )

      onChanged()
    }

  const submitRefund =
    async (event) => {
      event.preventDefault()

      await api.post(
        `/merchant/refunds${qs}`,

        {
          ...refundForm,

          amount:
            Number(
              refundForm.amount
            ),
        },

        opts
      )

      setRefundForm({
        orderId: "",
        amount: "",
        reason: "",
      })

      onChanged()
    }

  const walletData =
    wallet?.wallet || {}

  const refunds =
    wallet?.refunds || []

  return (
    <section className="crm-panel settings-panel">
      <p className="eyebrow">
        כספי החנות
      </p>

      <h2>
        ארנק וזיכויים
      </h2>

      <div className="wallet-balance-grid">
        <div className="wallet-balance-card">
          <span>
            יתרה זמינה
          </span>

          <strong>
            ₪{" "}
            {
              walletData.balance ||
              0
            }
          </strong>
        </div>

        <div className="wallet-balance-card">
          <span>
            תשלום הבא לחנות
          </span>

          <strong>
            ₪{" "}
            {
              walletData.pendingPayout ||
              0
            }
          </strong>
        </div>

        <div className="wallet-balance-card">
          <span>
            רזרבה לזיכויים
          </span>

          <strong>
            ₪{" "}
            {
              walletData.reserve ||
              0
            }
          </strong>
        </div>
      </div>

      {canWrite && (
        <button
          className="text-link"
          onClick={
            requestPayout
          }
        >
          בקשת העברה לבנק ←
        </button>
      )}

      <h3>
        בקשות זיכוי
      </h3>

      {refunds.length ===
        0 ? (
        <p>
          אין כרגע בקשות זיכוי.
        </p>
      ) : (
        <div className="order-table">
          {refunds.map(
            (refund) => (
              <div
                className="refund-row"
                key={
                  refund.id
                }
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
                  ₪{" "}
                  {
                    refund.amount
                  }
                </strong>

                <span
                  className={`order-status ${
                    refund.status ===
                    "approved"
                      ? "done"
                      : "pending"
                  }`}
                >
                  {refund.status ===
                  "pending-platform"
                    ? "ממתין לאישור מערכת"
                    : refund.status ===
                      "approved"
                    ? "מאושר"
                    : refund.status}
                </span>
              </div>
            )
          )}
        </div>
      )}

      {canRefund && (
        <form
          className="inline-form"
          onSubmit={
            submitRefund
          }
        >
          <h3>
            יצירת זיכוי חדש
          </h3>

          <div className="form-grid">
            <label>
              מזהה הזמנה

              <input
                required
                value={
                  refundForm.orderId
                }
                onChange={(
                  event
                ) =>
                  setRefundForm({
                    ...refundForm,

                    orderId:
                      event
                        .target
                        .value,
                  })
                }
              />
            </label>

            <label>
              סכום (₪)

              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={
                  refundForm.amount
                }
                onChange={(
                  event
                ) =>
                  setRefundForm({
                    ...refundForm,

                    amount:
                      event
                        .target
                        .value,
                  })
                }
              />
            </label>

            <label className="wide">
              סיבת הזיכוי

              <input
                required
                value={
                  refundForm.reason
                }
                onChange={(
                  event
                ) =>
                  setRefundForm({
                    ...refundForm,

                    reason:
                      event
                        .target
                        .value,
                  })
                }
              />
            </label>
          </div>

          <button
            className="checkout-button"
            type="submit"
          >
            שליחת בקשת זיכוי
          </button>
        </form>
      )}
    </section>
  )
}

// ======================================================
// COUPONS
// ======================================================

function CouponsTab({
  coupons,
  canWrite,
  onChanged,
  isAdmin,
  storeSlug,
}) {
  const opts = {
    auth: true,

    scope:
      isAdmin
        ? "admin"
        : "merchant",
  }

  const qs =
    isAdmin &&
    storeSlug
      ? `?storeSlug=${encodeURIComponent(
          storeSlug
        )}`
      : ""

  const [form, setForm] =
    useState({
      code: "",
      percentOff: "",
    })

  const addCoupon =
    async (event) => {
      event.preventDefault()

      await api.post(
        `/merchant/coupons${qs}`,

        {
          code:
            form.code,

          percentOff:
            Number(
              form.percentOff
            ),
        },

        opts
      )

      setForm({
        code: "",
        percentOff: "",
      })

      onChanged()
    }

  const toggleCoupon =
    async (coupon) => {
      await api.patch(
        `/merchant/coupons/${coupon.id}${qs}`,

        {
          active:
            !coupon.active,
        },

        opts
      )

      onChanged()
    }

  return (
    <section className="crm-panel settings-panel">
      <p className="eyebrow">
        שיווק והטבות
      </p>

      <h2>
        קופונים
      </h2>

      {canWrite && (
        <form
          className="inline-form"
          onSubmit={
            addCoupon
          }
        >
          <div className="form-grid">
            <label>
              קוד קופון

              <input
                required
                value={
                  form.code
                }
                onChange={(
                  event
                ) =>
                  setForm({
                    ...form,

                    code:
                      event
                        .target
                        .value,
                  })
                }
              />
            </label>

            <label>
              אחוז הנחה

              <input
                required
                type="number"
                min="1"
                max="90"
                value={
                  form.percentOff
                }
                onChange={(
                  event
                ) =>
                  setForm({
                    ...form,

                    percentOff:
                      event
                        .target
                        .value,
                  })
                }
              />
            </label>
          </div>

          <button
            className="checkout-button"
            type="submit"
          >
            יצירת קופון
          </button>
        </form>
      )}

      <div className="marketing-cards">
        {coupons.length ===
        0 ? (
          <p>
            עדיין אין קופונים.
          </p>
        ) : (
          coupons.map(
            (coupon) => (
              <div
                key={
                  coupon.id
                }
              >
                <strong>
                  {
                    coupon.code
                  }
                </strong>

                <span>
                  {
                    coupon.percentOff
                  }
                  % הנחה ·{" "}
                  {coupon.active
                    ? "פעיל"
                    : "מושבת"}
                </span>

                {canWrite && (
                  <button
                    className="text-link"
                    onClick={() =>
                      toggleCoupon(
                        coupon
                      )
                    }
                  >
                    {coupon.active
                      ? "השבתה ←"
                      : "הפעלה ←"}
                  </button>
                )}
              </div>
            )
          )
        )}
      </div>
    </section>
  )
}

// ======================================================
// SETTINGS
// ======================================================

function SettingsTab({
  store,
  canWrite,
  onChanged,
  isAdmin,
  storeSlug,
}) {
  const opts = {
    auth: true,

    scope:
      isAdmin
        ? "admin"
        : "merchant",
  }

  const qs =
    isAdmin &&
    storeSlug
      ? `?storeSlug=${encodeURIComponent(
          storeSlug
        )}`
      : ""

  const [form, setForm] =
    useState({
      about:
        store.about ||
        "",

      phone:
        store.phone ||
        "",

      email:
        store.email ||
        "",

      feeIls:
        store.shipping
          ?.feeIls ??
        0,

      minDays:
        store.shipping
          ?.minDays ??
        1,

      maxDays:
        store.shipping
          ?.maxDays ??
        5,
    })

  useEffect(() => {
    setForm({
      about:
        store.about ||
        "",

      phone:
        store.phone ||
        "",

      email:
        store.email ||
        "",

      feeIls:
        store.shipping
          ?.feeIls ??
        0,

      minDays:
        store.shipping
          ?.minDays ??
        1,

      maxDays:
        store.shipping
          ?.maxDays ??
        5,
    })
  }, [store])

  const save =
    async (event) => {
      event.preventDefault()

      await api.patch(
        `/merchant/store${qs}`,

        {
          about:
            form.about,

          phone:
            form.phone,

          email:
            form.email,

          shipping: {
            feeIls:
              safeNumber(
                form.feeIls
              ),

            minDays:
              safeNumber(
                form.minDays,
                1
              ),

            maxDays:
              safeNumber(
                form.maxDays,
                5
              ),
          },
        },

        opts
      )

      onChanged()
    }

  return (
    <section className="crm-panel settings-panel">
      <p className="eyebrow">
        פרטי החנות
      </p>

      <h2>
        הגדרות ומשלוחים
      </h2>

      <form
        className="inline-form"
        onSubmit={save}
      >
        <div className="form-grid">
          <label className="wide">
            תיאור החנות

            <input
              disabled={
                !canWrite
              }
              value={
                form.about
              }
              onChange={(
                event
              ) =>
                setForm({
                  ...form,

                  about:
                    event
                      .target
                      .value,
                })
              }
            />
          </label>

          <label>
            טלפון

            <input
              disabled={
                !canWrite
              }
              value={
                form.phone
              }
              onChange={(
                event
              ) =>
                setForm({
                  ...form,

                  phone:
                    event
                      .target
                      .value,
                })
              }
            />
          </label>

          <label>
            אימייל

            <input
              disabled={
                !canWrite
              }
              value={
                form.email
              }
              onChange={(
                event
              ) =>
                setForm({
                  ...form,

                  email:
                    event
                      .target
                      .value,
                })
              }
            />
          </label>

          <label>
            עלות משלוח (₪)

            <input
              disabled={
                !canWrite
              }
              type="number"
              min="0"
              value={
                form.feeIls
              }
              onChange={(
                event
              ) =>
                setForm({
                  ...form,

                  feeIls:
                    event
                      .target
                      .value,
                })
              }
            />
          </label>

          <label>
            ימי אספקה מינימום

            <input
              disabled={
                !canWrite
              }
              type="number"
              min="1"
              max="30"
              value={
                form.minDays
              }
              onChange={(
                event
              ) =>
                setForm({
                  ...form,

                  minDays:
                    event
                      .target
                      .value,
                })
              }
            />
          </label>

          <label>
            ימי אספקה מקסימום

            <input
              disabled={
                !canWrite
              }
              type="number"
              min="1"
              max="30"
              value={
                form.maxDays
              }
              onChange={(
                event
              ) =>
                setForm({
                  ...form,

                  maxDays:
                    event
                      .target
                      .value,
                })
              }
            />
          </label>
        </div>

        {canWrite && (
          <button
            className="checkout-button"
            type="submit"
          >
            שמירת שינויים
          </button>
        )}
      </form>
    </section>
  )
}

// ======================================================
// MANAGERS
// ======================================================

const MANAGER_PERMISSION_LABELS = {
  products:
    "מוצרים ומלאי",

  orders:
    "עדכון סטטוס הזמנות",

  coupons:
    "קופונים",

  wallet:
    "בקשת העברה מהארנק",

  refunds:
    "יצירת זיכויים",

  settings:
    "הגדרות חנות",
}

function ManagersTab({
  isAdmin,
  storeSlug,
  onChanged,
}) {
  const opts = {
    auth: true,

    scope:
      isAdmin
        ? "admin"
        : "merchant",
  }

  const qs =
    isAdmin &&
    storeSlug
      ? `?storeSlug=${encodeURIComponent(
          storeSlug
        )}`
      : ""

  const withSlug = (
    body = {}
  ) =>
    isAdmin &&
    storeSlug
      ? {
          ...body,
          storeSlug,
        }
      : body

  const [
    managers,
    setManagers,
  ] = useState([])

  const [
    managerError,
    setManagerError,
  ] = useState("")

  const [
    note,
    setNote,
  ] = useState("")

  const emptyForm = {
    name: "",
    email: "",
    password: "",
    permissions: {},
  }

  const [form, setForm] =
    useState(emptyForm)

  const load = () => {
    api.get(
      `/merchant/managers${qs}`,
      opts
    )
      .then(
        setManagers
      )
      .catch(
        (err) =>
          setManagerError(
            err.message
          )
      )
  }

  useEffect(() => {
    load()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug, isAdmin])

  const togglePermission = (
    key
  ) => {
    setForm(
      (current) => ({
        ...current,

        permissions: {
          ...current.permissions,

          [key]:
            !current.permissions[
              key
            ],
        },
      })
    )
  }

  const noteFrom = (
    res,
    fallback
  ) => {
    if (res?.devCode) {
      return `${fallback} (קוד פיתוח: ${res.devCode})`
    }

    return fallback
  }

  const addManager =
    async (event) => {
      event.preventDefault()

      setManagerError("")
      setNote("")

      try {
        const res =
          await api.post(
            `/merchant/managers${qs}`,

            withSlug(
              form
            ),

            opts
          )

        setNote(
          noteFrom(
            res,

            "המנהל נוסף. נשלח קוד אימות לאימייל."
          )
        )

        setForm(
          emptyForm
        )

        load()
        onChanged()
      } catch (err) {
        setManagerError(
          err.message
        )
      }
    }

  const removeManager =
    async (manager) => {
      const approved =
        window.confirm(
          `להסיר את המנהל "${manager.name}"?`
        )

      if (!approved) {
        return
      }

      await api.delete(
        `/merchant/managers/${manager.id}${qs}`,
        opts
      )

      load()
    }

  const resendCode =
    async (manager) => {
      setManagerError("")
      setNote("")

      try {
        const res =
          await api.post(
            `/merchant/managers/${manager.id}/resend-code${qs}`,

            withSlug({}),

            opts
          )

        setNote(
          noteFrom(
            res,

            res?.message ||
              "נשלח קוד אימות חדש"
          )
        )

        load()
      } catch (err) {
        setManagerError(
          err.message
        )
      }
    }

  return (
    <section className="crm-panel table-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">
            הרשאות ואבטחת צוות
          </p>

          <h2>
            מנהלי חנות
          </h2>
        </div>
      </div>

      {managerError && (
        <p className="form-error">
          {managerError}
        </p>
      )}

      {note && (
        <p className="checkout-note">
          {note}
        </p>
      )}

      <form
        className="inline-form"
        onSubmit={
          addManager
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
              onChange={(
                event
              ) =>
                setForm({
                  ...form,

                  name:
                    event
                      .target
                      .value,
                })
              }
            />
          </label>

          <label>
            אימייל

            <input
              required
              type="email"
              value={
                form.email
              }
              onChange={(
                event
              ) =>
                setForm({
                  ...form,

                  email:
                    event
                      .target
                      .value,
                })
              }
            />
          </label>

          <label>
            סיסמה זמנית

            <input
              required
              type="password"
              minLength={
                8
              }
              value={
                form.password
              }
              onChange={(
                event
              ) =>
                setForm({
                  ...form,

                  password:
                    event
                      .target
                      .value,
                })
              }
            />
          </label>
        </div>

        <div className="form-grid">
          {Object.entries(
            MANAGER_PERMISSION_LABELS
          ).map(
            ([
              key,
              label,
            ]) => (
              <label
                className="checkbox-label"
                key={key}
              >
                <input
                  type="checkbox"
                  checked={
                    !!form
                      .permissions[
                      key
                    ]
                  }
                  onChange={() =>
                    togglePermission(
                      key
                    )
                  }
                />

                {" "}
                {label}
              </label>
            )
          )}
        </div>

        <p className="checkout-note">
          לאחר ההוספה יישלח למנהל קוד אימות לאימייל.
          הכניסה תתאפשר לאחר אימות החשבון.
        </p>

        <button
          className="checkout-button"
          type="submit"
        >
          הוספת מנהל
        </button>
      </form>

      <div className="order-table">
        <div className="table-row table-head">
          <span>
            שם
          </span>

          <span>
            אימייל
          </span>

          <span>
            סטטוס אימות
          </span>

          <span>
            הרשאות
          </span>

          <span>
            פעולות
          </span>
        </div>

        {managers.map(
          (manager) => (
            <div
              className="table-row"
              key={
                manager.id
              }
            >
              <strong>
                {manager.name}
              </strong>

              <span>
                {manager.email}
              </span>

              <span
                className={`order-status ${
                  manager.verified
                    ? "done"
                    : "pending"
                }`}
              >
                {manager.verified
                  ? "מאומת"
                  : "ממתין לאימות"}
              </span>

              <span>
                {Object.entries(
                  manager.permissions ||
                    {}
                )
                  .filter(
                    ([, on]) =>
                      on
                  )
                  .map(
                    ([key]) =>
                      MANAGER_PERMISSION_LABELS[
                        key
                      ]
                  )
                  .filter(Boolean)
                  .join(", ") ||
                  "אין הרשאות"}
              </span>

              <div className="admin-product-actions">
                {!manager.verified && (
                  <button
                    className="text-link"
                    onClick={() =>
                      resendCode(
                        manager
                      )
                    }
                  >
                    שליחת קוד מחדש
                  </button>
                )}

                <button
                  className="text-link danger"
                  onClick={() =>
                    removeManager(
                      manager
                    )
                  }
                >
                  הסרה
                </button>
              </div>
            </div>
          )
        )}

        {managers.length ===
          0 && (
          <p>
            עדיין לא הוגדרו מנהלים לחנות.
          </p>
        )}
      </div>
    </section>
  )
}

export default MerchantCRM