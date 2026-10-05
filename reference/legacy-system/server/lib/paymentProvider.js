const { round2 } = require("./pricing")

const paymentMode = process.env.PAYMENTS_MODE || "sandbox"

function assertPaymentConfiguration() {
  if (process.env.NODE_ENV === "production" && paymentMode !== "provider") {
    throw new Error("PAYMENTS_MODE=provider is required in production; sandbox payments are disabled")
  }
  if (paymentMode === "provider" && !process.env.PAYMENT_PROVIDER) {
    throw new Error("PAYMENT_PROVIDER is required when PAYMENTS_MODE=provider")
  }
}

// Drop-in seam for a real "Marketplace + Sub-Merchant" payment processor.
// No provider is connected yet, so this only plans and records the intended
// split; swapping in a real gateway later means implementing the same shape
// (capture(order) -> { status, providerRef, split }) without touching callers.
function planSplit(order) {
  return {
    merchantAmount: round2(order.subtotal - order.discount + order.shipping),
    platformAmount: order.platformFee,
    currency: "ILS",
  }
}

function captureSandboxPayment(order) {
  if (process.env.NODE_ENV === "production" || paymentMode !== "sandbox") {
    throw new Error("Sandbox payment capture is disabled; connect the configured payment provider before accepting orders")
  }
  return {
    provider: null,
    providerRef: null,
    status: "sandbox-captured",
    capturedAt: new Date().toISOString(),
    split: planSplit(order),
  }
}

module.exports = { assertPaymentConfiguration, planSplit, captureSandboxPayment }
