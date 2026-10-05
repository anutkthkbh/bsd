// Israeli VAT rate - update to match the current rate published by the Tax Authority.
const VAT_RATE = 0.18
const PLATFORM_FEE_RATE = 0.20

// Business owner sets a base price and flags whether it already includes VAT.
// The platform always derives the ex-VAT price, then rebuilds the consumer price
// with VAT and the 20% platform fee added on top, per the pricing engine spec.
function priceBreakdown(basePrice, vatIncluded) {
  const priceExVat = vatIncluded ? basePrice / (1 + VAT_RATE) : basePrice
  const vatAmount = round2(priceExVat * VAT_RATE)
  const priceInclVat = round2(priceExVat + vatAmount)
  const platformFee = round2(priceInclVat * PLATFORM_FEE_RATE)
  const consumerPrice = round2(priceInclVat + platformFee)
  return { priceExVat: round2(priceExVat), vatAmount, priceInclVat, platformFee, consumerPrice }
}

function round2(value) {
  return Math.round(value * 100) / 100
}

module.exports = { VAT_RATE, PLATFORM_FEE_RATE, priceBreakdown, round2 }
