const { Router } = require("express")
const { randomUUID } = require("crypto")
const { getState, persist } = require("../lib/db")

const {
  requireAuth,
  requireOwnerOrAdmin,
  requirePermission,
  hashPassword,
} = require("../lib/auth")

const { issueCode } = require("../lib/codes")
const { priceBreakdown, round2 } = require("../lib/pricing")
const { sendMail } = require("../lib/mailer")

const router = Router()

// ======================================================
// ORDER STATUS
// ======================================================

const FULFILLMENT_STATUS_LABELS = {
  new: "הזמנה חדשה",
  confirmed: "אושרה",
  preparing: "בהכנה",
  ready: "מוכנה",
  shipped: "נשלחה",
  delivered: "נמסרה",
  cancelled: "בוטלה",
}

const FULFILLMENT_EMAIL_MESSAGES = {
  new: {
    subject: "ההזמנה שלך התקבלה",
    message:
      "ההזמנה שלך התקבלה בחנות וממתינה לטיפול.",
  },

  confirmed: {
    subject: "ההזמנה שלך אושרה",
    message:
      "החנות אישרה את ההזמנה שלך.",
  },

  preparing: {
    subject: "ההזמנה שלך בהכנה",
    message:
      "החנות התחילה להכין את ההזמנה שלך.",
  },

  ready: {
    subject: "ההזמנה שלך מוכנה",
    message:
      "ההזמנה שלך מוכנה להמשך הטיפול והמשלוח.",
  },

  shipped: {
    subject: "ההזמנה שלך נשלחה",
    message:
      "ההזמנה יצאה מהחנות והיא בדרך אליך.",
  },

  delivered: {
    subject: "ההזמנה שלך נמסרה",
    message:
      "ההזמנה סומנה כנמסרה. תודה שקנית במדרום.",
  },

  cancelled: {
    subject:
      "עדכון: ההזמנה שלך בוטלה",

    message:
      "ההזמנה סומנה כמבוטלת.",
  },
}

const LEGACY_FULFILLMENT_MAP = {
  "ממתין למשלוח": "new",
  "בטיפול": "preparing",
  "נשלח": "shipped",
  "נמסר": "delivered",
}

function normalizeFulfillmentStatus(order) {
  return (
    order.fulfillmentStatus ||
    LEGACY_FULFILLMENT_MAP[
      order.status
    ] ||
    "new"
  )
}

// ======================================================
// AUTH
// ======================================================

router.use(
  requireAuth(
    "owner",
    "accountant",
    "admin",
    "manager"
  )
)

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
}

// ======================================================
// STORE RESOLUTION
// ======================================================

function resolveStoreId(req) {
  if (req.auth?.role === "admin") {
    const slug =
      req.query.storeSlug ||
      req.body?.storeSlug ||
      req.params?.storeSlug

    if (!slug) {
      return null
    }

    const store =
      getState().stores.find(
        (item) =>
          item.slug === slug
      )

    return store?.id || null
  }

  return req.auth?.storeId || null
}

function myStore(req) {
  const storeId =
    resolveStoreId(req)

  if (!storeId) {
    return null
  }

  return getState().stores.find(
    (item) =>
      item.id === storeId
  )
}

// ======================================================
// STORE
// ======================================================

router.get(
  "/store",
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    res.json(store)
  }
)

router.patch(
  "/store",
  requirePermission("settings"),
  (req, res) => {
    const {
      about,
      phone,
      email,
      shipping,
      monthlyAdBudgetCommitted,
    } = req.body || {}

    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    persist((s) => {
      const target =
        s.stores.find(
          (item) =>
            item.id ===
            store.id
        )

      if (!target) {
        return
      }

      if (
        about !==
        undefined
      ) {
        target.about =
          about
      }

      if (
        phone !==
        undefined
      ) {
        target.phone =
          phone
      }

      if (
        email !==
        undefined
      ) {
        target.email =
          email
      }

      if (
        shipping !==
        undefined
      ) {
        target.shipping = {
          ...target.shipping,
          ...shipping,
        }
      }

      if (
        monthlyAdBudgetCommitted !==
        undefined
      ) {
        target.monthlyAdBudgetCommitted =
          monthlyAdBudgetCommitted
      }
    })

    res.json(
      myStore(req)
    )
  }
)

// ======================================================
// PRODUCTS
// ======================================================

const PRODUCT_STATUSES = [
  "draft",
  "active",
  "archived",
]

const INVENTORY_MODES = [
  "simple",
  "variants",
]

function cleanText(value) {
  return String(
    value ?? ""
  ).trim()
}

function parseBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback
  }

  if (
    typeof value ===
    "string"
  ) {
    const normalized =
      value
        .trim()
        .toLowerCase()

    if (
      [
        "false",
        "0",
        "no",
      ].includes(
        normalized
      )
    ) {
      return false
    }

    if (
      [
        "true",
        "1",
        "yes",
      ].includes(
        normalized
      )
    ) {
      return true
    }
  }

  return Boolean(value)
}

function nonNegativeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value)

  if (
    !Number.isFinite(
      number
    )
  ) {
    return fallback
  }

  return Math.max(
    0,
    number
  )
}

function isHttpsUrl(value) {
  try {
    return (
      new URL(value)
        .protocol ===
      "https:"
    )
  } catch {
    return false
  }
}

// ======================================================
// SIZES
// ======================================================

function normalizeSizes(value) {
  if (
    !Array.isArray(value)
  ) {
    return []
  }

  return [
    ...new Set(
      value
        .map(
          (item) =>
            cleanText(item)
        )
        .filter(Boolean)
    ),
  ]
}

// ======================================================
// IMAGES
// ======================================================

function normalizeImages(
  value,
  fallbackImageUrl = ""
) {
  let source =
    Array.isArray(value)
      ? value
      : []

  if (
    source.length === 0 &&
    fallbackImageUrl
  ) {
    source = [
      {
        url:
          fallbackImageUrl,

        primary:
          true,

        sortOrder:
          0,
      },
    ]
  }

  const images =
    source
      .map(
        (item, index) => {
          const raw =
            typeof item ===
            "string"
              ? {
                  url:
                    item,
                }
              : item || {}

          const url =
            cleanText(
              raw.url
            )

          if (!url) {
            return null
          }

          if (
            !isHttpsUrl(
              url
            )
          ) {
            throw new Error(
              "כל תמונת מוצר חייבת להיות כתובת HTTPS תקינה"
            )
          }

          return {
            id:
              cleanText(
                raw.id
              ) ||
              randomUUID(),

            url,

            primary:
              raw.primary ===
              true,

            sortOrder:
              Number.isFinite(
                Number(
                  raw.sortOrder
                )
              )
                ? Number(
                    raw.sortOrder
                  )
                : index,
          }
        }
      )
      .filter(Boolean)
      .sort(
        (a, b) =>
          a.sortOrder -
          b.sortOrder
      )

  if (
    images.length ===
    0
  ) {
    return []
  }

  const selectedPrimary =
    images.findIndex(
      (item) =>
        item.primary
    )

  const primaryIndex =
    selectedPrimary >= 0
      ? selectedPrimary
      : 0

  return images.map(
    (item, index) => ({
      ...item,

      primary:
        index ===
        primaryIndex,

      sortOrder:
        index,
    })
  )
}

// ======================================================
// VARIANTS
// ======================================================

function normalizeVariantImage(
  value,
  label
) {
  const url = cleanText(value)

  if (!url) {
    return ""
  }

  if (!isHttpsUrl(url)) {
    throw new Error(
      `${label} חייבת להיות כתובת HTTPS תקינה`
    )
  }

  return url
}

function normalizeVariants(
  value
) {
  if (
    !Array.isArray(value)
  ) {
    return []
  }

  return value.map(
    (item) => {
      const model =
        cleanText(
          item
            ?.attributes
            ?.model
        )

      const color =
        cleanText(
          item
            ?.attributes
            ?.color
        )

      const size =
        cleanText(
          item
            ?.attributes
            ?.size
        )

      const modelImageUrl =
        normalizeVariantImage(
          item?.modelImageUrl,
          "תמונת הדגם"
        )

      const colorImageUrl =
        normalizeVariantImage(
          item?.colorImageUrl,
          "תמונת הצבע"
        )

      const imageUrl =
        normalizeVariantImage(
          item?.imageUrl,
          "תמונת הווריאציה"
        )

      return {
        id:
          cleanText(
            item?.id
          ) ||
          randomUUID(),

        sku:
          cleanText(
            item?.sku
          ),

        attributes: {
          model,
          color,
          size,
        },

        modelImageUrl,
        colorImageUrl,
        imageUrl,

        stockQty:
          nonNegativeNumber(
            item?.stockQty,
            0
          ),

        active:
          item?.active !==
          false,
      }
    }
  )
}

// ======================================================
// NORMALIZE PRODUCT
// ======================================================

function normalizeProduct(
  product
) {
  const rawImages =
    Array.isArray(
      product.images
    ) &&
    product.images.length
      ? product.images
      : product.imageUrl
      ? [
          {
            id:
              `legacy-${product.id || "product"}-image-0`,

            url:
              product.imageUrl,

            primary:
              true,

            sortOrder:
              0,
          },
        ]
      : []

  const images =
    rawImages
      .map(
        (
          image,
          index
        ) => ({
          id:
            cleanText(
              image?.id
            ) ||
            `legacy-${product.id || "product"}-image-${index}`,

          url:
            cleanText(
              image?.url
            ),

          primary:
            image?.primary ===
            true,

          sortOrder:
            Number.isFinite(
              Number(
                image
                  ?.sortOrder
              )
            )
              ? Number(
                  image.sortOrder
                )
              : index,
        })
      )
      .filter(
        (image) =>
          image.url
      )
      .sort(
        (a, b) =>
          a.sortOrder -
          b.sortOrder
      )

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

  const inventoryMode =
    INVENTORY_MODES.includes(
      product.inventoryMode
    )
      ? product.inventoryMode
      : "simple"

  const stockQty =
    Number.isFinite(
      Number(
        product.stockQty
      )
    )
      ? Math.max(
          0,
          Number(
            product.stockQty
          )
        )
      : product.inStock ===
        false
      ? 0
      : 1

  const variants =
    normalizeVariants(
      product.variants
    )

  const status =
    PRODUCT_STATUSES.includes(
      product.status
    )
      ? product.status
      : "active"

  let inStock

  if (
    status !==
    "active"
  ) {
    inStock =
      false
  } else if (
    inventoryMode ===
    "variants"
  ) {
    inStock =
      variants.some(
        (variant) =>
          variant.active !==
            false &&
          Number(
            variant.stockQty
          ) >
            0
      )
  } else {
    inStock =
      stockQty > 0
  }

  const primaryImage =
    images.find(
      (item) =>
        item.primary
    ) ||
    images[0] ||
    null

  return {
    ...product,

    name:
      cleanText(
        product.name
      ),

    brand:
      cleanText(
        product.brand
      ),

    model:
      cleanText(
        product.model
      ),

    sku:
      cleanText(
        product.sku
      ),

    barcode:
      cleanText(
        product.barcode
      ),

    category:
      cleanText(
        product.category
      ),

    basePrice:
      nonNegativeNumber(
        product.basePrice,
        0
      ),

    vatIncluded:
      product.vatIncluded ===
      true,

    description:
      cleanText(
        product.description
      ),

    badge:
      cleanText(
        product.badge
      ),

    images,

    imageUrl:
      primaryImage?.url ||
      cleanText(
        product.imageUrl
      ),

    hasSizes:
      product.hasSizes ===
      true,

    sizes:
      normalizeSizes(
        product.sizes
      ),

    inventoryMode,

    stockQty,

    lowStockThreshold:
      nonNegativeNumber(
        product
          .lowStockThreshold,
        3
      ),

    variants,

    status,

    inStock,

    createdAt:
      product.createdAt ||
      null,

    updatedAt:
      product.updatedAt ||
      product.createdAt ||
      null,
  }
}

// ======================================================
// STOCK
// ======================================================

function productInStock(
  product
) {
  if (
    product.status !==
    "active"
  ) {
    return false
  }

  if (
    product.inventoryMode ===
    "variants"
  ) {
    return (
      product.variants ||
      []
    ).some(
      (variant) =>
        variant.active !==
          false &&
        Number(
          variant.stockQty
        ) >
          0
    )
  }

  return (
    Number(
      product.stockQty
    ) >
    0
  )
}

// ======================================================
// BUILD PRODUCT
// ======================================================

function buildProductPayload(
  input,
  existing = null
) {
  const current =
    existing
      ? normalizeProduct(
          existing
        )
      : null

  const now =
    new Date().toISOString()

  const name =
    input.name !==
    undefined
      ? cleanText(
          input.name
        )
      : current?.name ||
        ""

  const model =
    input.model !==
    undefined
      ? cleanText(
          input.model
        )
      : current?.model ||
        ""

  const brand =
    input.brand !==
    undefined
      ? cleanText(
          input.brand
        )
      : current?.brand ||
        ""

  const sku =
    input.sku !==
    undefined
      ? cleanText(
          input.sku
        )
      : current?.sku ||
        ""

  const barcode =
    input.barcode !==
    undefined
      ? cleanText(
          input.barcode
        )
      : current?.barcode ||
        ""

  const category =
    input.category !==
    undefined
      ? cleanText(
          input.category
        )
      : current?.category ||
        ""

  const description =
    input.description !==
    undefined
      ? cleanText(
          input.description
        )
      : current
          ?.description ||
        ""

  const badge =
    input.badge !==
    undefined
      ? cleanText(
          input.badge
        )
      : current?.badge ||
        ""

  const basePrice =
    input.basePrice !==
    undefined
      ? Number(
          input.basePrice
        )
      : Number(
          current
            ?.basePrice ||
            0
        )

  const vatIncluded =
    input.vatIncluded !==
    undefined
      ? parseBoolean(
          input.vatIncluded,
          true
        )
      : current
          ?.vatIncluded ??
        true

  const hasSizes =
    input.hasSizes !==
    undefined
      ? parseBoolean(
          input.hasSizes,
          false
        )
      : current
          ?.hasSizes ??
        false

  const sizes =
    input.sizes !==
    undefined
      ? normalizeSizes(
          input.sizes
        )
      : current?.sizes ||
        []

  const inventoryMode =
    input.inventoryMode !==
    undefined
      ? cleanText(
          input.inventoryMode
        )
      : current
          ?.inventoryMode ||
        "simple"

  let stockQty =
    input.stockQty !==
    undefined
      ? nonNegativeNumber(
          input.stockQty,
          0
        )
      : nonNegativeNumber(
          current?.stockQty,
          0
        )

  if (
    input.stockQty ===
      undefined &&
    input.inStock !==
      undefined &&
    inventoryMode ===
      "simple"
  ) {
    stockQty =
      parseBoolean(
        input.inStock,
        false
      )
        ? Math.max(
            stockQty,
            1
          )
        : 0
  }

  const lowStockThreshold =
    input.lowStockThreshold !==
    undefined
      ? nonNegativeNumber(
          input
            .lowStockThreshold,
          0
        )
      : nonNegativeNumber(
          current
            ?.lowStockThreshold,
          3
        )

  const status =
    input.status !==
    undefined
      ? cleanText(
          input.status
        )
      : current?.status ||
        "active"

  if (
    !INVENTORY_MODES.includes(
      inventoryMode
    )
  ) {
    throw new Error(
      "שיטת ניהול המלאי אינה תקינה"
    )
  }

  if (
    !PRODUCT_STATUSES.includes(
      status
    )
  ) {
    throw new Error(
      "סטטוס המוצר אינו תקין"
    )
  }

  if (
    !Number.isFinite(
      basePrice
    ) ||
    basePrice <
      0
  ) {
    throw new Error(
      "מחיר המוצר אינו תקין"
    )
  }

  let images

  if (
    input.images !==
      undefined ||
    input.imageUrl !==
      undefined ||
    !current
  ) {
    images =
      normalizeImages(
        input.images,

        input.imageUrl ||
          current?.imageUrl ||
          ""
      )
  } else {
    images =
      current.images ||
      []
  }

  const variants =
    input.variants !==
    undefined
      ? normalizeVariants(
          input.variants
        )
      : current
          ?.variants ||
        []

  const primaryImage =
    images.find(
      (item) =>
        item.primary
    ) ||
    images[0] ||
    null

  const product = {
    id:
      current?.id ||
      randomUUID(),

    storeId:
      current?.storeId ||
      null,

    name,
    brand,
    model,
    sku,
    barcode,
    category,
    basePrice,
    vatIncluded,
    description,
    badge,
    images,

    imageUrl:
      primaryImage?.url ||
      "",

    hasSizes,

    sizes,

    inventoryMode,

    stockQty,

    lowStockThreshold,

    variants,

    status,

    popularityScore:
      nonNegativeNumber(
        current
          ?.popularityScore,
        0
      ),

    createdAt:
      current?.createdAt ||
      now,

    updatedAt:
      now,
  }

  product.inStock =
    productInStock(
      product
    )

  return product
}

// ======================================================
// GET PRODUCTS
// ======================================================

router.get(
  "/products",
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const q =
      cleanText(
        req.query.q
      ).toLowerCase()

    const category =
      cleanText(
        req.query.category
      )

    const status =
      cleanText(
        req.query.status
      )

    let products =
      getState()
        .products
        .filter(
          (item) =>
            item.storeId ===
            store.id
        )
        .map(
          normalizeProduct
        )

    if (q) {
      products =
        products.filter(
          (product) =>
            [
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
        )
    }

    if (category) {
      products =
        products.filter(
          (product) =>
            product.category ===
            category
        )
    }

    if (status) {
      products =
        products.filter(
          (product) =>
            product.status ===
            status
        )
    }

    products.sort(
      (a, b) =>
        new Date(
          b.updatedAt ||
            b.createdAt ||
            0
        ) -
        new Date(
          a.updatedAt ||
            a.createdAt ||
            0
        )
    )

    res.json(products)
  }
)

// ======================================================
// CREATE PRODUCT
// ======================================================

router.post(
  "/products",
  requirePermission(
    "products"
  ),
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const name =
      cleanText(
        req.body?.name
      )

    const model =
      cleanText(
        req.body?.model
      )

    const category =
      cleanText(
        req.body?.category
      )

    if (
      !name ||
      !model ||
      !category ||
      req.body?.basePrice ===
        undefined
    ) {
      return res.status(400).json({
        error:
          "יש למלא שם מוצר, דגם, קטגוריה ומחיר",
      })
    }

    try {
      const product =
        buildProductPayload(
          req.body
        )

      if (
        product.images
          .length ===
        0
      ) {
        return res.status(400).json({
          error:
            "יש להוסיף לפחות תמונת מוצר אחת",
        })
      }

      product.storeId =
        store.id

      persist((s) => {
        s.products.push(
          product
        )
      })

      return res
        .status(201)
        .json(
          product
        )
    } catch (error) {
      return res.status(400).json({
        error:
          error.message,
      })
    }
  }
)

// ======================================================
// UPDATE PRODUCT
// ======================================================

router.patch(
  "/products/:id",
  requirePermission(
    "products"
  ),
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const existing =
      getState()
        .products
        .find(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id
        )

    if (!existing) {
      return res.status(404).json({
        error:
          "מוצר לא נמצא בחנות שלך",
      })
    }

    if (
      req.body?.model !==
        undefined &&
      !cleanText(
        req.body.model
      )
    ) {
      return res.status(400).json({
        error:
          "דגם המוצר הוא שדה חובה",
      })
    }

    try {
      const updated =
        buildProductPayload(
          req.body,
          existing
        )

      updated.storeId =
        store.id

      persist((s) => {
        const index =
          s.products.findIndex(
            (item) =>
              item.id ===
                req.params.id &&
              item.storeId ===
                store.id
          )

        if (
          index >=
          0
        ) {
          s.products[index] =
            updated
        }
      })

      return res.json(
        updated
      )
    } catch (error) {
      return res.status(400).json({
        error:
          error.message,
      })
    }
  }
)

// ======================================================
// DUPLICATE PRODUCT
// ======================================================

router.post(
  "/products/:id/duplicate",
  requirePermission(
    "products"
  ),
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const source =
      getState()
        .products
        .find(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id
        )

    if (!source) {
      return res.status(404).json({
        error:
          "מוצר לא נמצא בחנות שלך",
      })
    }

    const current =
      normalizeProduct(
        source
      )

    const now =
      new Date().toISOString()

    const duplicate = {
      ...current,

      id:
        randomUUID(),

      name:
        `${current.name} - עותק`,

      sku: "",

      barcode: "",

      status:
        "draft",

      images:
        current.images.map(
          (image) => ({
            ...image,

            id:
              randomUUID(),
          })
        ),

      variants:
        current.variants.map(
          (variant) => ({
            ...variant,

            id:
              randomUUID(),
          })
        ),

      createdAt:
        now,

      updatedAt:
        now,
    }

    duplicate.imageUrl =
      duplicate.images.find(
        (image) =>
          image.primary
      )?.url ||
      duplicate.images[0]
        ?.url ||
      ""

    duplicate.inStock =
      productInStock(
        duplicate
      )

    persist((s) => {
      s.products.push(
        duplicate
      )
    })

    return res
      .status(201)
      .json(
        duplicate
      )
  }
)

// ======================================================
// DELETE PRODUCT
// ======================================================

router.delete(
  "/products/:id",
  requirePermission(
    "products"
  ),
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const exists =
      getState()
        .products
        .some(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id
        )

    if (!exists) {
      return res.status(404).json({
        error:
          "מוצר לא נמצא בחנות שלך",
      })
    }

    persist((s) => {
      s.products =
        s.products.filter(
          (item) =>
            !(
              item.id ===
                req.params.id &&
              item.storeId ===
                store.id
            )
        )
    })

    res.status(204).end()
  }
)

// ======================================================
// ORDERS
// ======================================================

router.get(
  "/orders",
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    res.json(
      getState()
        .orders
        .filter(
          (item) =>
            item.storeId ===
            store.id
        )
        .map(
          (order) => ({
            ...order,

            fulfillmentStatus:
              normalizeFulfillmentStatus(
                order
              ),
          })
        )
    )
  }
)

// ======================================================
// UPDATE ORDER STATUS + CUSTOMER EMAIL
// ======================================================

router.patch(
  "/orders/:id/status",
  requirePermission(
    "orders"
  ),
  async (req, res) => {
    const requestedStatus =
      req.body
        ?.fulfillmentStatus ||
      req.body?.status

    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    if (
      !FULFILLMENT_STATUS_LABELS[
        requestedStatus
      ]
    ) {
      return res.status(400).json({
        error:
          "סטטוס טיפול לא תקין",
      })
    }

    const state =
      getState()

    const order =
      state.orders.find(
        (item) =>
          item.id ===
            req.params.id &&
          item.storeId ===
            store.id
      )

    if (!order) {
      return res.status(404).json({
        error:
          "הזמנה לא נמצאה",
      })
    }

    const previousStatus =
      normalizeFulfillmentStatus(
        order
      )

    if (
      previousStatus ===
      requestedStatus
    ) {
      return res.json({
        ...order,

        fulfillmentStatus:
          previousStatus,

        notification: {
          email:
            "skipped",

          reason:
            "status-unchanged",
        },
      })
    }

    const eventId =
      randomUUID()

    const changedAt =
      new Date().toISOString()

    persist((s) => {
      const target =
        s.orders.find(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id
        )

      if (!target) {
        return
      }

      target.fulfillmentStatus =
        requestedStatus

      target.status =
        FULFILLMENT_STATUS_LABELS[
          requestedStatus
        ]

      target.updatedAt =
        changedAt

      s.orderEvents.push({
        id:
          eventId,

        orderId:
          target.id,

        event:
          "fulfillment-status-changed",

        from:
          previousStatus,

        to:
          requestedStatus,

        actorType:
          req.auth?.role ||
          "merchant",

        actorId:
          req.auth?.id ||
          null,

        createdAt:
          changedAt,
      })
    })

    const updatedState =
      getState()

    const updated =
      updatedState.orders.find(
        (item) =>
          item.id ===
            req.params.id &&
          item.storeId ===
            store.id
      )

    let emailStatus =
      "skipped"

    let emailId =
      null

    try {
      const customer =
        updatedState.customers.find(
          (item) =>
            item.id ===
            updated.customerId
        )

      const customerEmail =
        updated
          .customerSnapshot
          ?.email ||
        customer?.email

      if (
        customerEmail
      ) {
        const template =
          FULFILLMENT_EMAIL_MESSAGES[
            requestedStatus
          ]

        const shortOrderId =
          updated.id.slice(
            0,
            8
          )

        const mail =
          await sendMail({
            to:
              customerEmail,

            subject:
              `${template.subject} · הזמנה ${shortOrderId}`,

            body: [
              `שלום ${
                updated
                  .customerSnapshot
                  ?.name ||
                customer?.name ||
                ""
              },`,

              "",

              template.message,

              "",

              `מספר הזמנה: ${shortOrderId}`,

              `חנות: ${
                updated
                  .storeName ||
                store.name
              }`,

              `סטטוס: ${
                FULFILLMENT_STATUS_LABELS[
                  requestedStatus
                ]
              }`,

              `סכום: ₪${updated.total}`,

              "",

              "תודה שקנית במדרום.",
            ].join(
              "\n"
            ),

            kind:
              `order-status-${requestedStatus}`,

            idempotencyKey:
              `order-status-${eventId}`,
          })

        emailStatus =
          "sent"

        emailId =
          mail?.id ||
          null
      }
    } catch (error) {
      emailStatus =
        "failed"

      console.error(
        "[merchant] order status email failed:",
        updated?.id,
        requestedStatus,
        error.message
      )
    }

    return res.json({
      ...updated,

      fulfillmentStatus:
        normalizeFulfillmentStatus(
          updated
        ),

      notification: {
        email:
          emailStatus,

        emailId,
      },
    })
  }
)

// ======================================================
// COUPONS
// ======================================================

router.get(
  "/coupons",
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    res.json(
      getState()
        .coupons
        .filter(
          (item) =>
            item.storeId ===
            store.id
        )
    )
  }
)

router.post(
  "/coupons",
  requirePermission(
    "coupons"
  ),
  (req, res) => {
    const {
      code,
      percentOff,
    } = req.body || {}

    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    if (
      !code ||
      !percentOff
    ) {
      return res.status(400).json({
        error:
          "יש לספק קוד ואחוז הנחה",
      })
    }

    const coupon = {
      id:
        randomUUID(),

      storeId:
        store.id,

      code:
        String(code)
          .trim()
          .toUpperCase(),

      percentOff:
        Number(
          percentOff
        ),

      active:
        true,
    }

    persist((s) => {
      s.coupons.push(
        coupon
      )
    })

    res
      .status(201)
      .json(
        coupon
      )
  }
)

router.patch(
  "/coupons/:id",
  requirePermission(
    "coupons"
  ),
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const exists =
      getState()
        .coupons
        .some(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id
        )

    if (!exists) {
      return res.status(404).json({
        error:
          "קופון לא נמצא",
      })
    }

    persist((s) => {
      const target =
        s.coupons.find(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id
        )

      if (!target) {
        return
      }

      if (
        req.body?.active !==
        undefined
      ) {
        target.active =
          Boolean(
            req.body.active
          )
      }

      if (
        req.body?.percentOff !==
        undefined
      ) {
        target.percentOff =
          Number(
            req.body
              .percentOff
          )
      }

      if (
        req.body?.code !==
        undefined
      ) {
        target.code =
          String(
            req.body.code
          )
            .trim()
            .toUpperCase()
      }
    })

    res.json(
      getState()
        .coupons
        .find(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id
        )
    )
  }
)

// ======================================================
// WALLET
// ======================================================

router.get(
  "/wallet",
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const refunds =
      getState()
        .refundRequests
        .filter(
          (item) =>
            item.storeId ===
            store.id
        )

    res.json({
      wallet:
        store.wallet,

      refunds,
    })
  }
)

router.post(
  "/wallet/payout-request",
  requirePermission(
    "wallet"
  ),
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const amount =
      store.wallet
        .pendingPayout

    persist((s) => {
      const target =
        s.stores.find(
          (item) =>
            item.id ===
            store.id
        )

      if (!target) {
        return
      }

      target.wallet.balance =
        0

      target.wallet.pendingPayout =
        0
    })

    res.json({
      message:
        `בקשת העברה של ₪ ${amount} נשלחה ` +
        `(סביבת הדגמה, ללא אינטגרציית בנק אמיתית)`,

      wallet:
        myStore(req)
          .wallet,
    })
  }
)

// ======================================================
// REFUNDS
// ======================================================

router.post(
  "/refunds",
  requirePermission(
    "refunds"
  ),
  (req, res) => {
    const {
      orderId,
      amount,
      reason,
    } = req.body || {}

    const state =
      getState()

    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const order =
      state.orders.find(
        (item) =>
          item.id ===
            orderId &&
          item.storeId ===
            store.id
      )

    if (!order) {
      return res.status(404).json({
        error:
          "הזמנה לא נמצאה בחנות שלך",
      })
    }

    const numericAmount =
      Number(amount)

    if (
      !Number.isFinite(
        numericAmount
      ) ||
      numericAmount <=
        0
    ) {
      return res.status(400).json({
        error:
          "סכום הזיכוי אינו תקין",
      })
    }

    const hasOpenRequest =
      state
        .refundRequests
        .some(
          (item) =>
            item.storeId ===
              store.id &&
            item.status ===
              "pending-platform"
        )

    const needsPlatformApproval =
      hasOpenRequest ||
      numericAmount >
        store.wallet
          .pendingPayout

    const refund = {
      id:
        randomUUID(),

      storeId:
        store.id,

      orderId,

      amount:
        numericAmount,

      reason:
        reason || "",

      status:
        needsPlatformApproval
          ? "pending-platform"
          : "approved",

      createdAt:
        new Date().toISOString(),
    }

    persist((s) => {
      s.refundRequests.push(
        refund
      )

      if (
        !needsPlatformApproval
      ) {
        const target =
          s.stores.find(
            (item) =>
              item.id ===
              store.id
          )

        if (target) {
          target.wallet.pendingPayout =
            round2(
              target
                .wallet
                .pendingPayout -
                refund.amount
            )
        }
      }
    })

    res
      .status(201)
      .json(
        refund
      )
  }
)

// ======================================================
// ANALYTICS
// ======================================================

router.get(
  "/analytics",
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const state =
      getState()

    const orders =
      state.orders.filter(
        (item) =>
          item.storeId ===
          store.id
      )

    const revenue =
      orders.reduce(
        (
          sum,
          order
        ) =>
          sum +
          Number(
            order.total ||
              0
          ),
        0
      )

    const reviews =
      state.reviews.filter(
        (item) =>
          item.storeId ===
          store.id
      )

    const rating =
      reviews.length
        ? reviews.reduce(
            (
              sum,
              item
            ) =>
              sum +
              Number(
                item.rating ||
                  0
              ),
            0
          ) /
          reviews.length
        : null

    res.json({
      orderCount:
        orders.length,

      revenue,

      reviewCount:
        reviews.length,

      rating,
    })
  }
)

// ======================================================
// PRICING
// ======================================================

router.post(
  "/pricing/preview",
  (req, res) => {
    const {
      basePrice,
      vatIncluded,
    } = req.body || {}

    if (
      basePrice ===
      undefined
    ) {
      return res.status(400).json({
        error:
          "יש לספק מחיר בסיס",
      })
    }

    res.json(
      priceBreakdown(
        Number(
          basePrice
        ),
        Boolean(
          vatIncluded
        )
      )
    )
  }
)

// ======================================================
// MANAGERS
// ======================================================

const MANAGER_PERMISSION_KEYS = [
  "products",
  "orders",
  "coupons",
  "wallet",
  "refunds",
  "settings",
]

function sanitizePermissions(
  input
) {
  const permissions = {}

  for (
    const key of
    MANAGER_PERMISSION_KEYS
  ) {
    permissions[key] =
      Boolean(
        input?.[key]
      )
  }

  return permissions
}

function toManagerView(
  manager
) {
  return {
    id:
      manager.id,

    name:
      manager.name,

    email:
      manager.email,

    role:
      manager.role,

    verified:
      manager.verified,

    permissions:
      manager.permissions ||
      {},

    createdAt:
      manager.createdAt,
  }
}

// ======================================================
// GET MANAGERS
// ======================================================

router.get(
  "/managers",
  requireOwnerOrAdmin,
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const managers =
      getState()
        .merchants
        .filter(
          (item) =>
            item.storeId ===
              store.id &&
            item.role ===
              "manager"
        )

    res.json(
      managers.map(
        toManagerView
      )
    )
  }
)

// ======================================================
// CREATE MANAGER
// ======================================================

router.post(
  "/managers",
  requireOwnerOrAdmin,
  async (req, res) => {
    const {
      name,
      email,
      password,
      permissions,
    } = req.body || {}

    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    if (
      !name ||
      !email ||
      !password ||
      password.length <
        8
    ) {
      return res.status(400).json({
        error:
          "יש לספק שם, אימייל וסיסמה בת 8 תווים לפחות",
      })
    }

    const normalizedEmail =
      normalizeEmail(
        email
      )

    const state =
      getState()

    const alreadyExists =
      state.merchants.some(
        (item) =>
          normalizeEmail(
            item.email
          ) ===
          normalizedEmail
      )

    if (
      alreadyExists
    ) {
      return res.status(409).json({
        error:
          "כבר קיים משתמש עם אימייל זה",
      })
    }

    const manager = {
      id:
        randomUUID(),

      storeId:
        store.id,

      name:
        String(
          name
        ).trim(),

      email:
        normalizedEmail,

      role:
        "manager",

      passwordHash:
        hashPassword(
          password
        ),

      verified:
        false,

      permissions:
        sanitizePermissions(
          permissions
        ),

      createdAt:
        new Date().toISOString(),
    }

    persist((s) => {
      s.merchants.push(
        manager
      )
    })

    let devCode

    try {
      const record =
        await issueCode(
          getState(),
          normalizedEmail,
          "manager-verify"
        )

      if (
        process.env
          .NODE_ENV !==
        "production"
      ) {
        devCode =
          record?.devCode
      }
    } catch (error) {
      console.error(
        "[merchant] manager verify code failed:",
        error.message
      )

      return res.status(502).json({
        error:
          "המנהל נוצר אך שליחת קוד האימות למייל נכשלה",
      })
    }

    res
      .status(201)
      .json({
        ...toManagerView(
          manager
        ),

        devCode,
      })
  }
)

// ======================================================
// UPDATE MANAGER
// ======================================================

router.patch(
  "/managers/:id",
  requireOwnerOrAdmin,
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const manager =
      getState()
        .merchants
        .find(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id &&
            item.role ===
              "manager"
        )

    if (!manager) {
      return res.status(404).json({
        error:
          "מנהל לא נמצא בחנות שלך",
      })
    }

    persist((s) => {
      const target =
        s.merchants.find(
          (item) =>
            item.id ===
            manager.id
        )

      if (!target) {
        return
      }

      if (
        req.body?.name
      ) {
        target.name =
          String(
            req.body.name
          ).trim()
      }

      if (
        req.body
          ?.permissions
      ) {
        target.permissions =
          sanitizePermissions(
            req.body
              .permissions
          )
      }
    })

    res.json(
      toManagerView(
        getState()
          .merchants
          .find(
            (item) =>
              item.id ===
              manager.id
          )
      )
    )
  }
)

// ======================================================
// DELETE MANAGER
// ======================================================

router.delete(
  "/managers/:id",
  requireOwnerOrAdmin,
  (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const exists =
      getState()
        .merchants
        .some(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id &&
            item.role ===
              "manager"
        )

    if (!exists) {
      return res.status(404).json({
        error:
          "מנהל לא נמצא בחנות שלך",
      })
    }

    persist((s) => {
      s.merchants =
        s.merchants.filter(
          (item) =>
            item.id !==
            req.params.id
        )
    })

    res.status(204).end()
  }
)

// ======================================================
// RESEND MANAGER VERIFY CODE
// ======================================================

router.post(
  "/managers/:id/resend-code",
  requireOwnerOrAdmin,
  async (req, res) => {
    const store =
      myStore(req)

    if (!store) {
      return res.status(404).json({
        error:
          "חנות לא נמצאה",
      })
    }

    const manager =
      getState()
        .merchants
        .find(
          (item) =>
            item.id ===
              req.params.id &&
            item.storeId ===
              store.id &&
            item.role ===
              "manager"
        )

    if (!manager) {
      return res.status(404).json({
        error:
          "מנהל לא נמצא בחנות שלך",
      })
    }

    if (
      manager.verified
    ) {
      return res.status(400).json({
        error:
          "האימייל כבר מאומת",
      })
    }

    try {
      const record =
        await issueCode(
          getState(),
          manager.email,
          "manager-verify"
        )

      return res.json({
        message:
          "נשלח קוד אימות חדש",

        devCode:
          process.env
            .NODE_ENV ===
          "production"
            ? undefined
            : record
                ?.devCode,
      })
    } catch (error) {
      console.error(
        "[merchant] manager verify resend failed:",
        error.message
      )

      return res.status(502).json({
        error:
          "שליחת הקוד נכשלה",
      })
    }
  }
)

// ======================================================
// EXPORT
// ======================================================

module.exports = router
