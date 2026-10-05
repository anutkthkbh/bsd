const { randomUUID } = require("crypto")
const { round2 } = require("./pricing")

// Purchase documentation: a customer-facing invoice per order, and a separate
// commission invoice representing the platform's fee charge to the merchant,
// matching the spec's "חשבונית מהעמלה" requirement.
function nextInvoiceNumber(state, seqKey) {
  state.invoiceSequence = state.invoiceSequence || { customer: 1000, commission: 5000 }
  const number = state.invoiceSequence[seqKey]++
  return number
}

function buildCustomerInvoice(state, order, store) {
  const number = nextInvoiceNumber(state, "customer")
  return {
    id: randomUUID(),
    number: `MD-INV-${number}`,
    type: "customer",
    orderId: order.id,
    customerId: order.customerId,
    storeId: store.id,
    storeName: store.name,
    issuedAt: new Date().toISOString(),
    lines: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    shipping: order.shipping,
    platformFee: order.platformFee,
    total: order.total,
  }
}

function buildCommissionInvoice(state, order, store) {
  const number = nextInvoiceNumber(state, "commission")
  return {
    id: randomUUID(),
    number: `MD-COM-${number}`,
    type: "commission",
    orderId: order.id,
    storeId: store.id,
    storeName: store.name,
    issuedAt: new Date().toISOString(),
    feeRatePercent: 20,
    amount: order.platformFee,
    merchantPayout: round2(order.subtotal - order.discount + order.shipping),
  }
}

module.exports = { buildCustomerInvoice, buildCommissionInvoice }
