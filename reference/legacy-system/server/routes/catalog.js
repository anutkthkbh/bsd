const { Router } = require("express")
const { randomUUID } = require("crypto")
const { getState, persist } = require("../lib/db")
const { requireAuth } = require("../lib/auth")
const { priceBreakdown } = require("../lib/pricing")
const { isPlatformClosed } = require("../lib/schedule")

const router = Router()

// ======================================================
// HELPERS
// ======================================================

function cleanText(value) {
  return String(value ?? "").trim()
}

function nonNegativeNumber(value, fallback = 0) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return fallback
  }

  return Math.max(0, number)
}

function normalizeImages(product) {
  let images = Array.isArray(product.images)
    ? product.images
        .map((image, index) => ({
          id:
            cleanText(image?.id) ||
            `${product.id}-image-${index}`,

          url:
            cleanText(image?.url),

          primary:
            image?.primary === true,

          sortOrder:
            Number.isFinite(
              Number(image?.sortOrder)
            )
              ? Number(image.sortOrder)
              : index,
        }))
        .filter((image) => image.url)
    : []

  // תמיכה במוצרים ישנים
  if (
    images.length === 0 &&
    product.imageUrl
  ) {
    images = [
      {
        id:
          `${product.id}-legacy-image`,

        url:
          cleanText(product.imageUrl),

        primary:
          true,

        sortOrder:
          0,
      },
    ]
  }

  images.sort(
    (a, b) =>
      a.sortOrder -
      b.sortOrder
  )

  if (
    images.length > 0 &&
    !images.some(
      (image) =>
        image.primary
    )
  ) {
    images[0].primary =
      true
  }

  return images
}

function normalizeVariants(product) {
  if (
    !Array.isArray(
      product.variants
    )
  ) {
    return []
  }

  return product.variants.map(
    (variant) => ({
      id:
        cleanText(variant.id),

      sku:
        cleanText(variant.sku),

      attributes: {
        model:
          cleanText(
            variant
              ?.attributes
              ?.model
          ),

        color:
          cleanText(
            variant
              ?.attributes
              ?.color
          ),

        size:
          cleanText(
            variant
              ?.attributes
              ?.size
          ),
      },

      modelImageUrl:
        cleanText(
          variant.modelImageUrl
        ),

      colorImageUrl:
        cleanText(
          variant.colorImageUrl
        ),

      imageUrl:
        cleanText(
          variant.imageUrl
        ),

      stockQty:
        nonNegativeNumber(
          variant.stockQty,
          0
        ),

      active:
        variant.active !==
        false,
    })
  )
}

function normalizeProduct(product) {
  const images =
    normalizeImages(product)

  const variants =
    normalizeVariants(product)

  const inventoryMode =
    product.inventoryMode ===
    "variants"
      ? "variants"
      : "simple"

  let stockQty

  if (
    Number.isFinite(
      Number(
        product.stockQty
      )
    )
  ) {
    stockQty =
      Math.max(
        0,
        Number(
          product.stockQty
        )
      )
  } else {
    // Legacy
    stockQty =
      product.inStock ===
      false
        ? 0
        : 1
  }

  const status =
    product.status ||
    "active"

  let inStock =
    false

  if (
    status ===
    "active"
  ) {
    if (
      inventoryMode ===
      "variants"
    ) {
      inStock =
        variants.some(
          (variant) =>
            variant.active &&
            variant.stockQty >
              0
        )
    } else {
      inStock =
        stockQty >
        0
    }
  }

  const primaryImage =
    images.find(
      (image) =>
        image.primary
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

    description:
      cleanText(
        product.description
      ),

    badge:
      cleanText(
        product.badge
      ),

    basePrice:
      nonNegativeNumber(
        product.basePrice,
        0
      ),

    images,

    imageUrl:
      primaryImage?.url ||
      "",

    variants,

    inventoryMode,

    stockQty,

    lowStockThreshold:
      nonNegativeNumber(
        product.lowStockThreshold,
        3
      ),

    hasSizes:
      product.hasSizes ===
      true,

    sizes:
      Array.isArray(
        product.sizes
      )
        ? [
            ...new Set(
              product.sizes
                .map(cleanText)
                .filter(Boolean)
            ),
          ]
        : [],

    status,

    inStock,
  }
}

function withConsumerPrice(product) {
  const normalized =
    normalizeProduct(product)

  return {
    ...normalized,

    price:
      priceBreakdown(
        normalized.basePrice,
        normalized.vatIncluded
      ).consumerPrice,
  }
}

function isActiveProduct(product) {
  return (
    !product.status ||
    product.status ===
      "active"
  )
}

// ======================================================
// PLATFORM STATUS
// ======================================================

router.get(
  "/status",
  (req, res) => {
    res.json(
      isPlatformClosed(
        getState()
      )
    )
  }
)

// ======================================================
// STORES
// ======================================================

router.get(
  "/stores",
  (req, res) => {
    res.json(
      getState()
        .stores
        .filter(
          (store) =>
            store.status ===
            "active"
        )
    )
  }
)

router.get(
  "/stores/:slug",
  (req, res) => {
    const store =
      getState()
        .stores
        .find(
          (item) =>
            item.slug ===
              req.params.slug &&
            item.status ===
              "active"
        )

    if (!store) {
      return res
        .status(404)
        .json({
          error:
            "חנות לא נמצאה",
        })
    }

    res.json(store)
  }
)

// ======================================================
// DYNAMIC CATEGORIES
// ======================================================

router.get(
  "/categories",
  (req, res) => {
    const state =
      getState()

    const activeStoreIds =
      new Set(
        state.stores
          .filter(
            (store) =>
              store.status ===
              "active"
          )
          .map(
            (store) =>
              store.id
          )
      )

    const categories = [
      ...new Set(
        state.products
          .filter(
            (product) =>
              activeStoreIds.has(
                product.storeId
              ) &&
              isActiveProduct(
                product
              )
          )
          .map(
            (product) =>
              cleanText(
                product.category
              )
          )
          .filter(Boolean)
      ),
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "he"
        )
    )

    res.json([
      "הכול",
      ...categories,
    ])
  }
)

// ======================================================
// PRODUCTS
// ======================================================

router.get(
  "/products",
  (req, res) => {
    const {
      search = "",
      category = "הכול",
      sort = "popular",
    } = req.query

    const state =
      getState()

    const activeStoreIds =
      new Set(
        state.stores
          .filter(
            (store) =>
              store.status ===
              "active"
          )
          .map(
            (store) =>
              store.id
          )
      )

    let products =
      state.products.filter(
        (product) =>
          activeStoreIds.has(
            product.storeId
          ) &&
          isActiveProduct(
            product
          )
      )

    const searchText =
      cleanText(
        search
      ).toLowerCase()

    if (searchText) {
      products =
        products.filter(
          (product) =>
            [
              product.name,
              product.description,
              product.brand,
              product.model,
              product.category,
              product.sku,
              product.barcode,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(
                searchText
              )
        )
    }

    if (
      category &&
      category !==
        "הכול"
    ) {
      products =
        products.filter(
          (product) =>
            product.category ===
            category
        )
    }

    if (
      sort ===
      "new"
    ) {
      products = [
        ...products,
      ].sort(
        (a, b) =>
          new Date(
            b.createdAt ||
              0
          ) -
          new Date(
            a.createdAt ||
              0
          )
      )
    } else {
      products = [
        ...products,
      ].sort(
        (a, b) =>
          Number(
            b.popularityScore ||
              0
          ) -
          Number(
            a.popularityScore ||
              0
          )
      )
    }

    res.json(
      products.map(
        (product) => {
          const store =
            state.stores.find(
              (store) =>
                store.id ===
                product.storeId
            )

          return {
            ...withConsumerPrice(
              product
            ),

            store:
              store?.name ||
              "",

            storeSlug:
              store?.slug ||
              "",
          }
        }
      )
    )
  }
)

// ======================================================
// SINGLE PRODUCT
// ======================================================

router.get(
  "/products/:id",
  (req, res) => {
    const state =
      getState()

    const product =
      state.products.find(
        (item) =>
          item.id ===
            req.params.id &&
          isActiveProduct(
            item
          )
      )

    if (!product) {
      return res
        .status(404)
        .json({
          error:
            "מוצר לא נמצא",
        })
    }

    const store =
      state.stores.find(
        (item) =>
          item.id ===
            product.storeId &&
          item.status ===
            "active"
      )

    if (!store) {
      return res
        .status(404)
        .json({
          error:
            "החנות אינה פעילה",
        })
    }

    res.json({
      ...withConsumerPrice(
        product
      ),

      store:
        store.name,

      storeSlug:
        store.slug,
    })
  }
)

// ======================================================
// REVIEWS
// ======================================================

router.get(
  "/reviews",
  (req, res) => {
    const {
      storeSlug,
    } = req.query

    const state =
      getState()

    let reviews =
      state.reviews

    if (storeSlug) {
      const store =
        state.stores.find(
          (item) =>
            item.slug ===
            storeSlug
        )

      reviews =
        reviews.filter(
          (review) =>
            review.storeId ===
            store?.id
        )
    }

    res.json(
      reviews.map(
        (review) => ({
          ...review,

          storeName:
            state.stores.find(
              (store) =>
                store.id ===
                review.storeId
            )?.name,
        })
      )
    )
  }
)

router.post(
  "/reviews",
  requireAuth("customer"),
  (req, res) => {
    const {
      storeSlug,
      rating,
      text,
    } = req.body

    const state =
      getState()

    const store =
      state.stores.find(
        (item) =>
          item.slug ===
          storeSlug
      )

    if (!store) {
      return res
        .status(404)
        .json({
          error:
            "חנות לא נמצאה",
        })
    }

    if (
      !rating ||
      !text
    ) {
      return res
        .status(400)
        .json({
          error:
            "יש לספק דירוג וטקסט",
        })
    }

    const review = {
      id:
        randomUUID(),

      storeId:
        store.id,

      customerId:
        req.auth.id,

      author:
        req.auth.name,

      rating:
        Number(rating),

      text,

      createdAt:
        new Date().toISOString(),
    }

    persist((s) => {
      s.reviews.push(
        review
      )
    })

    res
      .status(201)
      .json({
        ...review,

        storeName:
          store.name,
      })
  }
)

// ======================================================
// VISIT TRACKING
// ======================================================

const MAX_VISIT_LOG =
  20000

function isTrackablePath(value) {
  return (
    typeof value ===
      "string" &&
    value.length >
      0 &&
    value.length <=
      300 &&
    value.startsWith("/") &&
    !value.includes(
      "://"
    )
  )
}

router.post(
  "/track-visit",
  (req, res) => {
    const {
      path,
      visitorId,
      referrer,
    } = req.body || {}

    if (
      !isTrackablePath(
        path
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "נתיב לא תקין",
        })
    }

    const visit = {
      id:
        randomUUID(),

      path,

      visitorId:
        typeof visitorId ===
        "string"
          ? visitorId.slice(
              0,
              64
            )
          : "",

      referrer:
        typeof referrer ===
        "string"
          ? referrer.slice(
              0,
              300
            )
          : "",

      createdAt:
        new Date().toISOString(),
    }

    persist((s) => {
      s.visits.push(
        visit
      )

      if (
        s.visits.length >
        MAX_VISIT_LOG
      ) {
        s.visits =
          s.visits.slice(
            -MAX_VISIT_LOG
          )
      }
    })

    res
      .status(204)
      .end()
  }
)

module.exports = router