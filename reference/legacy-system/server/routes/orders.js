const { Router } = require("express")
const { getState } = require("../lib/db")
const { requireAuth } = require("../lib/auth")
const {
  prepareCheckout,
  finalizeCheckout,
  attachStoreOrders,
} = require("../lib/checkout")
const { sendMail } = require("../lib/mailer")
const { sendSms } = require("../lib/sms")

const router = Router()

function currentCustomer(req) {
  return getState().customers.find(
    (item) => item.id === req.auth.id
  )
}

async function notifyCompletedOrder(masterOrder) {
  const state = getState()

  for (const order of masterOrder?.storeOrders || []) {
    const store = state.stores.find(
      (item) => item.id === order.storeId
    )

    if (!store) continue

    const customer =
      order.customerSnapshot ||
      masterOrder.customerSnapshot ||
      {}

    const itemsText = (order.items || [])
      .map(
        (item) =>
          `${item.name} × ${item.qty}`
      )
      .join(", ")

    // מייל אחד בלבד ללקוח בזמן ביצוע ההזמנה
    if (customer.email) {
      try {
        await sendMail({
          to: customer.email,

          subject:
            `סיכום הזמנה ${order.id.slice(0, 8)} מ-${store.name}`,

          body:
            `תודה על הרכישה!\n` +
            `מספר הזמנה: ${order.id.slice(0, 8)}\n` +
            `מוצרים: ${itemsText}\n` +
            `סה"כ לתשלום: ₪${order.total}\n` +
            `חשבונית ${order.invoiceId} זמינה בחשבונך.`,

          kind: "order-confirmation",

          idempotencyKey:
            `order-confirmation-${order.id}`,
        })
      } catch (error) {
        console.error(
          "[orders] customer email failed:",
          error.message
        )
      }
    }

    // למוכר נשלח SMS בלבד
    // אין מייל נוסף לחנות
    if (store.phone) {
      try {
        await sendSms({
          phone: store.phone,

          message:
            `מדרום: התקבלה הזמנה חדשה #${order.id.slice(0, 8)} ` +
            `בסך ₪${order.total}. היכנס ל-CRM לצפייה וטיפול.`,
        })
      } catch (error) {
        console.error(
          "[orders] merchant SMS failed:",
          error.message
        )
      }
    }
  }
}

// ======================================================
// CHECKOUT PREPARE
// ======================================================

router.post(
  "/checkout/prepare",
  requireAuth("customer"),
  (req, res) => {
    const customer = currentCustomer(req)

    if (!customer) {
      return res.status(404).json({
        error: "לקוח לא נמצא",
      })
    }

    const {
      items,
      couponCode,
    } = req.body || {}

    const result =
      prepareCheckout(
        customer,
        items,
        couponCode
      )

    if (!result.ok) {
      return res.status(result.status).json({
        error: result.error,
        code: result.code,
        missingFields: result.missingFields,
        productId: result.productId,
      })
    }

    res.status(201).json(result.session)
  }
)

// ======================================================
// CHECKOUT PAY
// ======================================================

router.post(
  "/checkout/pay",
  requireAuth("customer"),
  async (req, res) => {
    const customer = currentCustomer(req)

    if (!customer) {
      return res.status(404).json({
        error: "לקוח לא נמצא",
      })
    }

    const { checkoutId } = req.body || {}

    if (!checkoutId) {
      return res.status(400).json({
        error: "חסר מזהה תהליך תשלום",
      })
    }

    const paymentId =
      `sandbox_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`

    const result = finalizeCheckout({
      checkoutId,

      customerId:
        customer.id,

      paymentId,

      paymentMeta: {
        provider: "sandbox",
        providerRef: paymentId,
        status: "sandbox-captured",
        capturedAt:
          new Date().toISOString(),
      },
    })

    if (!result.ok) {
      return res
        .status(result.status)
        .json({
          error: result.error,
          code: result.code,
          productId: result.productId,
        })
    }

    // שולחים התראות רק בפעם הראשונה
    // שבה ההזמנה הושלמה
    if (!result.alreadyCompleted) {
      await notifyCompletedOrder(
        result.masterOrder
      )
    }

    res.status(201).json({
      masterOrder:
        result.masterOrder,

      loyaltyCoupon:
        result.loyaltyCoupon,
    })
  }
)

// ======================================================
// PAYMENT WEBHOOK
// ======================================================

function verifyWebhookSignature(req) {
  if (
    process.env.PAYMENTS_MODE !== "provider"
  ) {
    return true
  }

  const secret =
    process.env.PAYMENT_WEBHOOK_SECRET

  return (
    Boolean(secret) &&
    req.headers["x-webhook-secret"] === secret
  )
}

router.post(
  "/payments/webhook",
  async (req, res) => {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({
        error: "חתימת webhook לא תקינה",
      })
    }

    const {
      checkoutId,
      paymentId,
      status,
      providerRef,
      provider,
    } = req.body || {}

    if (!checkoutId || !paymentId) {
      return res.status(400).json({
        error: "payload לא תקין",
      })
    }

    if (
      status &&
      status !== "paid"
    ) {
      return res.status(200).json({
        received: true,
      })
    }

    // מאתרים את הלקוח מתוך
    // Checkout Session השמור בשרת
    const session =
      getState().checkoutSessions.find(
        (item) =>
          item.id === checkoutId
      )

    if (!session) {
      return res.status(404).json({
        error:
          "לא נמצא תהליך תשלום מתאים",

        code:
          "CHECKOUT_NOT_FOUND",
      })
    }

    const result =
      finalizeCheckout({
        checkoutId,

        customerId:
          session.customerId,

        paymentId,

        paymentMeta: {
          provider:
            provider ||
            process.env.PAYMENT_PROVIDER ||
            null,

          providerRef:
            providerRef ||
            paymentId,

          status: "paid",

          capturedAt:
            new Date().toISOString(),
        },
      })

    if (!result.ok) {
      return res
        .status(result.status)
        .json({
          error: result.error,
          code: result.code,
        })
    }

    if (!result.alreadyCompleted) {
      await notifyCompletedOrder(
        result.masterOrder
      )
    }

    res.status(200).json({
      received: true,
    })
  }
)

// ======================================================
// MY ORDERS
// ======================================================

router.get(
  "/mine",
  requireAuth("customer"),
  (req, res) => {
    const state = getState()

    const masterOrders =
      state.masterOrders
        .filter(
          (item) =>
            item.customerId ===
            req.auth.id
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        )
        .map(
          (item) =>
            attachStoreOrders(
              state,
              item
            )
        )

    res.json(masterOrders)
  }
)

router.get(
  "/:id/invoice",
  requireAuth("customer"),
  (req, res) => {
    const state = getState()

    const order =
      state.orders.find(
        (item) =>
          item.id === req.params.id &&
          item.customerId ===
            req.auth.id
      )

    if (!order) {
      return res.status(404).json({
        error: "הזמנה לא נמצאה",
      })
    }

    const invoice =
      state.invoices.find(
        (item) =>
          item.id === order.invoiceId
      )

    if (!invoice) {
      return res.status(404).json({
        error: "חשבונית לא נמצאה",
      })
    }

    res.json(invoice)
  }
)

module.exports = router