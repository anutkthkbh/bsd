// checkout.js
// מנוע Checkout משותף:
// - תמחור בצד השרת
// - Checkout Session עם Snapshot
// - תמיכה בדגם / צבע / מידה
// - בדיקת מלאי לפי וריאציה
// - הורדת מלאי לאחר תשלום
// - Master Order + Store Orders
// - אידמפוטנטיות לפי checkoutId

const { randomUUID } = require("crypto")

const {
  getState,
  persist,
} = require("./db")

const {
  priceBreakdown,
  round2,
} = require("./pricing")

const {
  isPlatformClosed,
} = require("./schedule")

const {
  buildCustomerInvoice,
  buildCommissionInvoice,
} = require("./invoices")

const {
  planSplit,
} = require("./paymentProvider")

const {
  getMissingCustomerFields,
  buildCustomerSnapshot,
} = require("./customerValidation")

const CHECKOUT_SESSION_TTL_MS =
  30 * 60 * 1000

// ======================================================
// GENERAL HELPERS
// ======================================================

function cleanText(value) {
  return String(
    value ?? ""
  ).trim()
}

function normalizeQty(value) {
  const number =
    Number(value)

  if (
    !Number.isFinite(
      number
    )
  ) {
    return 1
  }

  return Math.max(
    1,
    Math.floor(
      number
    )
  )
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

// ======================================================
// PRODUCT HELPERS
// ======================================================

function productIsActive(
  product
) {
  if (!product) {
    return false
  }

  return (
    !product.status ||
    product.status ===
      "active"
  )
}

function productUsesVariants(
  product
) {
  if (!product) {
    return false
  }

  return (
    product.inventoryMode ===
      "variants" ||
    (
      Array.isArray(
        product.variants
      ) &&
      product.variants.length >
        0
    )
  )
}

function getVariant(
  product,
  variantId
) {
  if (
    !product ||
    !variantId ||
    !Array.isArray(
      product.variants
    )
  ) {
    return null
  }

  return (
    product.variants.find(
      (variant) =>
        variant.id ===
        variantId
    ) ||
    null
  )
}

function getVariantAttributes(
  variant
) {
  return {
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
  }
}

function getVariantImage(
  variant,
  product
) {
  return (
    cleanText(
      variant?.imageUrl
    ) ||
    cleanText(
      variant?.colorImageUrl
    ) ||
    cleanText(
      variant?.modelImageUrl
    ) ||
    cleanText(
      product?.imageUrl
    )
  )
}

function getSimpleStock(
  product
) {
  if (!product) {
    return 0
  }

  if (
    Number.isFinite(
      Number(
        product.stockQty
      )
    )
  ) {
    return Math.max(
      0,
      Number(
        product.stockQty
      )
    )
  }

  // מוצר Legacy שלא ניהל stockQty בעבר.
  // שומרים תאימות להתנהגות הישנה.
  if (
    product.inStock ===
    false
  ) {
    return 0
  }

  return Number.MAX_SAFE_INTEGER
}

function normalizeSimpleSelection(
  product,
  selection
) {
  const result = {
    model: "",
    color: "",
    size: "",
  }

  if (
    product?.hasSizes &&
    Array.isArray(
      product.sizes
    ) &&
    product.sizes.length
  ) {
    result.size =
      cleanText(
        selection?.size
      )
  }

  return result
}

// ======================================================
// RECALCULATE STOCK
// ======================================================

function recomputeProductStock(
  product
) {
  if (!product) {
    return
  }

  if (
    !productIsActive(
      product
    )
  ) {
    product.inStock =
      false

    return
  }

  if (
    productUsesVariants(
      product
    )
  ) {
    product.inStock =
      (
        product.variants ||
        []
      ).some(
        (variant) =>
          variant.active !==
            false &&
          Number(
            variant.stockQty ||
              0
          ) > 0
      )

    return
  }

  if (
    Number.isFinite(
      Number(
        product.stockQty
      )
    )
  ) {
    product.inStock =
      Number(
        product.stockQty
      ) > 0
  }
}

// ======================================================
// COUPONS
// ======================================================

function findCoupon(
  state,
  storeId,
  couponCode
) {
  if (!couponCode) {
    return null
  }

  const normalizedCode =
    String(
      couponCode
    )
      .trim()
      .toUpperCase()

  return (
    state.coupons.find(
      (item) =>
        item.storeId ===
          storeId &&
        String(
          item.code
        ).toUpperCase() ===
          normalizedCode &&
        item.active
    ) ||
    null
  )
}

// ======================================================
// STORE BREAKDOWN
// ======================================================

function buildStoreBreakdown(
  state,
  store,
  lines,
  couponCode
) {
  const breakdowns =
    lines.map(
      (line) => ({
        line,

        breakdown:
          priceBreakdown(
            line.product
              .basePrice,

            line.product
              .vatIncluded
          ),
      })
    )

  const merchantSubtotal =
    round2(
      breakdowns.reduce(
        (
          sum,
          item
        ) =>
          sum +
          item.breakdown
            .priceInclVat *
            item.line.qty,
        0
      )
    )

  const platformFee =
    round2(
      breakdowns.reduce(
        (
          sum,
          item
        ) =>
          sum +
          item.breakdown
            .platformFee *
            item.line.qty,
        0
      )
    )

  const coupon =
    findCoupon(
      state,
      store.id,
      couponCode
    )

  const discount =
    coupon
      ? round2(
          merchantSubtotal *
            (
              Number(
                coupon.percentOff ||
                  0
              ) /
              100
            )
        )
      : 0

  const shipping =
    nonNegativeNumber(
      store.shipping?.feeIls,
      0
    )

  const total =
    round2(
      merchantSubtotal -
        discount +
        platformFee +
        shipping
    )

  return {
    storeId:
      store.id,

    storeName:
      store.name,

    items:
      breakdowns.map(
        ({
          line,
          breakdown,
        }) => {
          const variant =
            line.variant ||
            null

          const options =
            variant
              ? getVariantAttributes(
                  variant
                )
              : normalizeSimpleSelection(
                  line.product,
                  line.selection
                )

          return {
            productId:
              line.product.id,

            variantId:
              variant?.id ||
              null,

            name:
              line.product.name,

            sku:
              cleanText(
                variant?.sku ||
                line.product
                  .sku
              ),

            qty:
              line.qty,

            unitPrice:
              breakdown
                .consumerPrice,

            options,

            imageUrl:
              variant
                ? getVariantImage(
                    variant,
                    line.product
                  )
                : cleanText(
                    line.product
                      .imageUrl
                  ),
          }
        }
      ),

    subtotal:
      merchantSubtotal,

    discount,

    platformFee,

    shipping,

    total,

    couponCode:
      coupon?.code ||
      null,
  }
}

// ======================================================
// CART VALIDATION
// ======================================================

function validateAndGroupCart(
  state,
  items
) {
  if (
    !Array.isArray(
      items
    ) ||
    items.length ===
      0
  ) {
    return {
      ok: false,

      status:
        400,

      code:
        "EMPTY_CART",

      error:
        "העגלה ריקה",
    }
  }

  const enriched = []

  for (
    const rawLine of
    items
  ) {
    const product =
      state.products.find(
        (item) =>
          item.id ===
          rawLine.productId
      )

    if (!product) {
      return {
        ok: false,

        status:
          400,

        code:
          "PRODUCT_NOT_FOUND",

        error:
          "אחד המוצרים בעגלה כבר לא קיים",

        productId:
          rawLine.productId,
      }
    }

    if (
      !productIsActive(
        product
      )
    ) {
      return {
        ok: false,

        status:
          409,

        code:
          "PRODUCT_INACTIVE",

        error:
          `${product.name} אינו זמין כרגע`,

        productId:
          product.id,
      }
    }

    const qty =
      normalizeQty(
        rawLine.qty
      )

    // ==================================================
    // VARIANT PRODUCT
    // ==================================================

    if (
      productUsesVariants(
        product
      )
    ) {
      if (
        !rawLine.variantId
      ) {
        return {
          ok: false,

          status:
            400,

          code:
            "VARIANT_REQUIRED",

          error:
            `יש לבחור דגם, צבע או מידה עבור ${product.name}`,

          productId:
            product.id,
        }
      }

      const variant =
        getVariant(
          product,
          rawLine.variantId
        )

      if (!variant) {
        return {
          ok: false,

          status:
            409,

          code:
            "VARIANT_NOT_FOUND",

          error:
            `האפשרות שנבחרה עבור ${product.name} כבר אינה קיימת`,

          productId:
            product.id,

          variantId:
            rawLine.variantId,
        }
      }

      if (
        variant.active ===
        false
      ) {
        return {
          ok: false,

          status:
            409,

          code:
            "VARIANT_INACTIVE",

          error:
            `האפשרות שנבחרה עבור ${product.name} אינה זמינה כרגע`,

          productId:
            product.id,

          variantId:
            variant.id,
        }
      }

      const available =
        nonNegativeNumber(
          variant.stockQty,
          0
        )

      if (
        available <
        qty
      ) {
        return {
          ok: false,

          status:
            409,

          code:
            "ITEM_OUT_OF_STOCK",

          error:
            `${product.name} אינו זמין בכמות המבוקשת`,

          productId:
            product.id,

          variantId:
            variant.id,

          available,
        }
      }

      enriched.push({
        product,

        variant,

        qty,

        selection:
          getVariantAttributes(
            variant
          ),
      })

      continue
    }

    // ==================================================
    // SIMPLE PRODUCT
    // ==================================================

    const available =
      getSimpleStock(
        product
      )

    if (
      available <
      qty
    ) {
      return {
        ok: false,

        status:
          409,

        code:
          "ITEM_OUT_OF_STOCK",

        error:
          `${product.name} אינו זמין בכמות המבוקשת`,

        productId:
          product.id,

        available:
          Number.isSafeInteger(
            available
          )
            ? available
            : undefined,
      }
    }

    const selection =
      normalizeSimpleSelection(
        product,
        rawLine.selection
      )

    // מוצר פשוט עם מידות
    if (
      product.hasSizes &&
      Array.isArray(
        product.sizes
      ) &&
      product.sizes.length >
        0
    ) {
      if (
        !selection.size
      ) {
        return {
          ok: false,

          status:
            400,

          code:
            "SIZE_REQUIRED",

          error:
            `יש לבחור מידה עבור ${product.name}`,

          productId:
            product.id,
        }
      }

      const normalizedSizes =
        product.sizes.map(
          cleanText
        )

      if (
        !normalizedSizes.includes(
          selection.size
        )
      ) {
        return {
          ok: false,

          status:
            400,

          code:
            "INVALID_SIZE",

          error:
            `המידה שנבחרה עבור ${product.name} אינה תקינה`,

          productId:
            product.id,
        }
      }
    }

    enriched.push({
      product,

      variant:
        null,

      qty,

      selection,
    })
  }

  // ====================================================
  // GROUP BY STORE
  // ====================================================

  const grouped =
    new Map()

  for (
    const line of
    enriched
  ) {
    const store =
      state.stores.find(
        (item) =>
          item.id ===
          line.product.storeId
      )

    if (
      !store ||
      store.status !==
        "active"
    ) {
      return {
        ok: false,

        status:
          409,

        code:
          "STORE_INACTIVE",

        error:
          "אחת החנויות בעגלה אינה פעילה כרגע",
      }
    }

    if (
      !grouped.has(
        store.id
      )
    ) {
      grouped.set(
        store.id,
        {
          store,

          lines:
            [],
        }
      )
    }

    grouped
      .get(
        store.id
      )
      .lines.push(
        line
      )
  }

  return {
    ok: true,

    grouped,
  }
}

// ======================================================
// SERIALIZE SESSION
// ======================================================

function serializeSession(
  session
) {
  return {
    checkoutId:
      session.id,

    customer: {
      name:
        session
          .customerSnapshot
          .name,

      email:
        session
          .customerSnapshot
          .email,

      phone:
        session
          .customerSnapshot
          .phone,

      phone2:
        session
          .customerSnapshot
          .phone2,

      city:
        session
          .customerSnapshot
          .city,

      address:
        session
          .customerSnapshot
          .address,

      zip:
        session
          .customerSnapshot
          .zip,
    },

    stores:
      session.stores,

    subtotal:
      session.subtotal,

    discount:
      session.discount,

    shipping:
      session.shipping,

    platformFee:
      session.platformFee,

    total:
      session.total,

    expiresAt:
      session.expiresAt,
  }
}

// ======================================================
// ATTACH STORE ORDERS
// ======================================================

function attachStoreOrders(
  state,
  masterOrder
) {
  if (
    !masterOrder
  ) {
    return null
  }

  return {
    ...masterOrder,

    storeOrders:
      state.orders.filter(
        (item) =>
          item.masterOrderId ===
          masterOrder.id
      ),
  }
}

// ======================================================
// PREPARE CHECKOUT
// ======================================================

function prepareCheckout(
  customer,
  items,
  couponCode
) {
  const state =
    getState()

  // ====================================================
  // SHABBAT / CLOSURE
  // ====================================================

  const closed =
    isPlatformClosed(
      state
    )

  if (
    closed.closed
  ) {
    return {
      ok: false,

      status:
        423,

      code:
        "PLATFORM_CLOSED",

      error:
        `הקנייה סגורה כרגע (${closed.reason}). אפשר להמשיך לעיין בקטלוג ולהזמין לאחר מכן.`,
    }
  }

  // ====================================================
  // CUSTOMER PROFILE
  // ====================================================

  const missingFields =
    getMissingCustomerFields(
      customer
    )

  if (
    missingFields.length
  ) {
    return {
      ok: false,

      status:
        409,

      code:
        "PROFILE_INCOMPLETE",

      error:
        "יש להשלים את פרטי הלקוח לפני מעבר לתשלום",

      missingFields,
    }
  }

  // ====================================================
  // CART
  // ====================================================

  const grouped =
    validateAndGroupCart(
      state,
      items
    )

  if (
    !grouped.ok
  ) {
    return grouped
  }

  // ====================================================
  // STORE BREAKDOWNS
  // ====================================================

  const stores = [
    ...grouped
      .grouped
      .values(),
  ].map(
    ({
      store,
      lines,
    }) =>
      buildStoreBreakdown(
        state,
        store,
        lines,
        couponCode
      )
  )

  // ====================================================
  // SESSION
  // ====================================================

  const session = {
    id:
      randomUUID(),

    customerId:
      customer.id,

    customerSnapshot:
      buildCustomerSnapshot(
        customer
      ),

    stores,

    subtotal:
      round2(
        stores.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item.subtotal,
          0
        )
      ),

    discount:
      round2(
        stores.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item.discount,
          0
        )
      ),

    shipping:
      round2(
        stores.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item.shipping,
          0
        )
      ),

    platformFee:
      round2(
        stores.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item.platformFee,
          0
        )
      ),

    total:
      round2(
        stores.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item.total,
          0
        )
      ),

    status:
      "pending",

    masterOrderId:
      null,

    createdAt:
      new Date()
        .toISOString(),

    expiresAt:
      new Date(
        Date.now() +
          CHECKOUT_SESSION_TTL_MS
      ).toISOString(),
  }

  persist(
    (s) => {
      if (
        !Array.isArray(
          s.checkoutSessions
        )
      ) {
        s.checkoutSessions =
          []
      }

      s.checkoutSessions.push(
        session
      )
    }
  )

  return {
    ok: true,

    session:
      serializeSession(
        session
      ),
  }
}

// ======================================================
// MARK SESSION FAILED
// ======================================================

function markSessionFailed(
  sessionId
) {
  persist(
    (s) => {
      const target =
        s.checkoutSessions.find(
          (item) =>
            item.id ===
            sessionId
        )

      if (target) {
        target.status =
          "failed"
      }
    }
  )
}

// ======================================================
// REVALIDATE SESSION INVENTORY
// ======================================================

function validateSessionInventory(
  state,
  session
) {
  for (
    const storeBreakdown of
    session.stores
  ) {
    const store =
      state.stores.find(
        (item) =>
          item.id ===
          storeBreakdown.storeId
      )

    if (
      !store ||
      store.status !==
        "active"
    ) {
      return {
        ok: false,

        status:
          409,

        code:
          "STORE_INACTIVE",

        error:
          "אחת החנויות בהזמנה אינה פעילה יותר",
      }
    }

    for (
      const item of
      storeBreakdown.items
    ) {
      const product =
        state.products.find(
          (entry) =>
            entry.id ===
            item.productId
        )

      if (
        !product ||
        !productIsActive(
          product
        )
      ) {
        return {
          ok: false,

          status:
            409,

          code:
            "ITEM_OUT_OF_STOCK",

          error:
            "אחד המוצרים בהזמנה אינו זמין יותר",

          productId:
            item.productId,
        }
      }

      const qty =
        normalizeQty(
          item.qty
        )

      // ================================================
      // VARIANT
      // ================================================

      if (
        item.variantId
      ) {
        const variant =
          getVariant(
            product,
            item.variantId
          )

        if (
          !variant ||
          variant.active ===
            false
        ) {
          return {
            ok: false,

            status:
              409,

            code:
              "VARIANT_NOT_AVAILABLE",

            error:
              `${product.name}: הדגם, הצבע או המידה שנבחרו אינם זמינים יותר`,

            productId:
              item.productId,

            variantId:
              item.variantId,
          }
        }

        const available =
          nonNegativeNumber(
            variant.stockQty,
            0
          )

        if (
          available <
          qty
        ) {
          return {
            ok: false,

            status:
              409,

            code:
              "ITEM_OUT_OF_STOCK",

            error:
              `${product.name}: אין מספיק מלאי עבור הדגם, הצבע או המידה שנבחרו`,

            productId:
              item.productId,

            variantId:
              item.variantId,

            available,
          }
        }

        continue
      }

      // ================================================
      // PRODUCT REQUIRES VARIANT
      // ================================================

      if (
        productUsesVariants(
          product
        )
      ) {
        return {
          ok: false,

          status:
            409,

          code:
            "VARIANT_REQUIRED",

          error:
            `${product.name}: חסרה בחירת וריאציה`,

          productId:
            item.productId,
        }
      }

      // ================================================
      // SIMPLE STOCK
      // ================================================

      const available =
        getSimpleStock(
          product
        )

      if (
        available <
        qty
      ) {
        return {
          ok: false,

          status:
            409,

          code:
            "ITEM_OUT_OF_STOCK",

          error:
            `${product.name} אינו זמין יותר בכמות המבוקשת`,

          productId:
            item.productId,

          available,
        }
      }
    }
  }

  return {
    ok: true,
  }
}

// ======================================================
// DEDUCT STOCK
// ======================================================

function deductItemStock(
  state,
  item
) {
  const product =
    state.products.find(
      (entry) =>
        entry.id ===
        item.productId
    )

  if (!product) {
    return
  }

  const qty =
    normalizeQty(
      item.qty
    )

  // ====================================================
  // VARIANT STOCK
  // ====================================================

  if (
    item.variantId
  ) {
    const variant =
      getVariant(
        product,
        item.variantId
      )

    if (variant) {
      variant.stockQty =
        Math.max(
          0,
          nonNegativeNumber(
            variant.stockQty,
            0
          ) -
            qty
        )
    }
  }

  // ====================================================
  // SIMPLE STOCK
  // ====================================================

  else if (
    Number.isFinite(
      Number(
        product.stockQty
      )
    )
  ) {
    product.stockQty =
      Math.max(
        0,
        Number(
          product.stockQty
        ) -
          qty
      )
  }

  // ====================================================
  // POPULARITY
  // ====================================================

  product.popularityScore =
    Number(
      product.popularityScore ||
        0
    ) +
    qty

  recomputeProductStock(
    product
  )

  product.updatedAt =
    new Date()
      .toISOString()
}

// ======================================================
// FINALIZE CHECKOUT
// ======================================================

function finalizeCheckout({
  checkoutId,
  customerId,
  paymentId,
  paymentMeta = {},
}) {
  const state =
    getState()

  const session =
    state.checkoutSessions.find(
      (item) =>
        item.id ===
          checkoutId &&
        item.customerId ===
          customerId
    )

  // ====================================================
  // SESSION NOT FOUND
  // ====================================================

  if (!session) {
    return {
      ok: false,

      status:
        404,

      code:
        "CHECKOUT_NOT_FOUND",

      error:
        "לא נמצא תהליך תשלום מתאים",
    }
  }

  // ====================================================
  // IDEMPOTENCY
  // ====================================================

  if (
    session.status ===
    "completed"
  ) {
    const masterOrder =
      state.masterOrders.find(
        (item) =>
          item.id ===
          session.masterOrderId
      )

    return {
      ok: true,

      alreadyCompleted:
        true,

      masterOrder:
        attachStoreOrders(
          state,
          masterOrder
        ),

      loyaltyCoupon:
        null,
    }
  }

  // ====================================================
  // FAILED SESSION
  // ====================================================

  if (
    session.status ===
    "failed"
  ) {
    return {
      ok: false,

      status:
        409,

      code:
        "CHECKOUT_SESSION_FAILED",

      error:
        "תהליך התשלום הזה נכשל, יש להתחיל הזמנה חדשה",
    }
  }

  // ====================================================
  // EXPIRED
  // ====================================================

  if (
    new Date(
      session.expiresAt
    ).getTime() <
    Date.now()
  ) {
    markSessionFailed(
      session.id
    )

    return {
      ok: false,

      status:
        409,

      code:
        "CHECKOUT_EXPIRED",

      error:
        "פג תוקף תהליך התשלום, יש להתחיל מחדש",
    }
  }

  // ====================================================
  // REVALIDATE INVENTORY
  // ====================================================

  const inventoryCheck =
    validateSessionInventory(
      state,
      session
    )

  if (
    !inventoryCheck.ok
  ) {
    markSessionFailed(
      session.id
    )

    return {
      ok: false,

      ...inventoryCheck,
    }
  }

  // ====================================================
  // MASTER ORDER
  // ====================================================

  const masterOrder = {
    id:
      randomUUID(),

    customerId:
      session.customerId,

    customerSnapshot:
      session.customerSnapshot,

    storeOrderIds:
      [],

    subtotal:
      session.subtotal,

    discount:
      session.discount,

    shipping:
      session.shipping,

    platformFee:
      session.platformFee,

    total:
      session.total,

    paymentStatus:
      "paid",

    paymentId,

    createdAt:
      new Date()
        .toISOString(),
  }

  const storeOrders =
    []

  // ====================================================
  // COMMIT ORDER
  // ====================================================

  persist(
    (s) => {
      if (
        !Array.isArray(
          s.orders
        )
      ) {
        s.orders =
          []
      }

      if (
        !Array.isArray(
          s.masterOrders
        )
      ) {
        s.masterOrders =
          []
      }

      if (
        !Array.isArray(
          s.orderEvents
        )
      ) {
        s.orderEvents =
          []
      }

      if (
        !Array.isArray(
          s.invoices
        )
      ) {
        s.invoices =
          []
      }

      if (
        !Array.isArray(
          s.commissionInvoices
        )
      ) {
        s.commissionInvoices =
          []
      }

      for (
        const storeBreakdown of
        session.stores
      ) {
        const store =
          s.stores.find(
            (item) =>
              item.id ===
              storeBreakdown.storeId
          )

        if (!store) {
          continue
        }

        // ==============================================
        // STORE ORDER
        // ==============================================

        const order = {
          id:
            randomUUID(),

          masterOrderId:
            masterOrder.id,

          customerId:
            session.customerId,

          customerSnapshot:
            session.customerSnapshot,

          storeId:
            store.id,

          storeName:
            store.name,

          items:
            storeBreakdown.items,

          subtotal:
            storeBreakdown.subtotal,

          discount:
            storeBreakdown.discount,

          platformFee:
            storeBreakdown.platformFee,

          shipping:
            storeBreakdown.shipping,

          total:
            storeBreakdown.total,

          couponCode:
            storeBreakdown.couponCode,

          fulfillmentStatus:
            "new",

          status:
            "הזמנה חדשה",

          paymentStatus:
            "paid",

          paymentId,

          createdAt:
            masterOrder.createdAt,
        }

        // ==============================================
        // PAYMENT SNAPSHOT
        // ==============================================

        order.payment = {
          provider:
            paymentMeta.provider ||
            null,

          providerRef:
            paymentMeta.providerRef ||
            paymentId,

          status:
            paymentMeta.status ||
            "paid",

          capturedAt:
            paymentMeta.capturedAt ||
            masterOrder.createdAt,

          split:
            planSplit(
              order
            ),
        }

        // ==============================================
        // SAVE ORDER
        // ==============================================

        s.orders.push(
          order
        )

        masterOrder
          .storeOrderIds
          .push(
            order.id
          )

        storeOrders.push(
          order
        )

        // ==============================================
        // STORE WALLET
        // ==============================================

        if (
          !store.wallet
        ) {
          store.wallet = {
            balance:
              0,

            pendingPayout:
              0,

            reserve:
              0,
          }
        }

        store.wallet.pendingPayout =
          round2(
            Number(
              store.wallet
                .pendingPayout ||
                0
            ) +
              (
                order.subtotal -
                order.discount +
                order.shipping
              )
          )

        store.revenueTotal =
          round2(
            Number(
              store.revenueTotal ||
                0
            ) +
              order.subtotal -
              order.discount
          )

        // ==============================================
        // EXACT STOCK DEDUCTION
        // ==============================================

        for (
          const item of
          storeBreakdown.items
        ) {
          deductItemStock(
            s,
            item
          )
        }

        // ==============================================
        // INVOICES
        // ==============================================

        const invoice =
          buildCustomerInvoice(
            s,
            order,
            store
          )

        const commissionInvoice =
          buildCommissionInvoice(
            s,
            order,
            store
          )

        s.invoices.push(
          invoice
        )

        s.commissionInvoices.push(
          commissionInvoice
        )

        order.invoiceId =
          invoice.id

        // ==============================================
        // EVENT
        // ==============================================

        s.orderEvents.push({
          id:
            randomUUID(),

          orderId:
            order.id,

          event:
            "created",

          from:
            null,

          to:
            order.fulfillmentStatus,

          actorType:
            "system",

          actorId:
            null,

          createdAt:
            order.createdAt,
        })
      }

      // ================================================
      // MASTER ORDER
      // ================================================

      s.masterOrders.push(
        masterOrder
      )

      // ================================================
      // COMPLETE SESSION
      // ================================================

      const target =
        s.checkoutSessions.find(
          (item) =>
            item.id ===
            session.id
        )

      if (target) {
        target.status =
          "completed"

        target.masterOrderId =
          masterOrder.id
      }

      // ================================================
      // LOYALTY
      // ================================================

      const customer =
        s.customers.find(
          (item) =>
            item.id ===
            session.customerId
        )

      if (customer) {
        customer.purchaseCount =
          Number(
            customer.purchaseCount ||
              0
          ) +
          1

        if (
          customer.purchaseCount ===
            3 &&
          !customer.loyaltyCoupon
        ) {
          customer.loyaltyCoupon = {
            code:
              `TODA-${customer.id
                .slice(
                  0,
                  5
                )
                .toUpperCase()}`,

            percentOff:
              10,
          }
        }
      }
    }
  )

  // ====================================================
  // FINAL RESULT
  // ====================================================

  const finalState =
    getState()

  const customer =
    finalState.customers.find(
      (item) =>
        item.id ===
        session.customerId
    )

  return {
    ok: true,

    masterOrder: {
      ...masterOrder,

      storeOrders,
    },

    loyaltyCoupon:
      customer
        ?.purchaseCount ===
      3
        ? customer
            .loyaltyCoupon
        : null,
  }
}

// ======================================================
// EXPORT
// ======================================================

module.exports = {
  prepareCheckout,
  finalizeCheckout,
  attachStoreOrders,
}