const EXIT_FEE_ILS = 3000
const REVENUE_WAIVER_THRESHOLD_ILS = 30000

// Encodes the "6 month commitment / 3,000 ILS exit fee / revenue waiver" rules
// from the spec so onboarding, merchant self-service exit, and admin
// enforcement all agree on the same computation.
function evaluateExit(store) {
  const withinCommitment = Date.now() < new Date(store.commitmentEndsAt).getTime()
  const metRevenueWaiver = store.revenueTotal >= REVENUE_WAIVER_THRESHOLD_ILS
  const metAdCommitment = store.adWaiverGranted || store.monthlyAdBudgetSpent >= store.monthlyAdBudgetCommitted
  const waived = !withinCommitment || (metRevenueWaiver && metAdCommitment)
  const feeIls = waived ? 0 : EXIT_FEE_ILS
  const reason = !withinCommitment
    ? "עברו 6 חודשים מהצטרפות החנות"
    : waived
      ? "החנות עמדה ברף ההכנסות ובהתחייבות הפרסום"
      : "יציאה בתוך 6 החודשים הראשונים ללא עמידה ברף הפטור"
  return { withinCommitment, metRevenueWaiver, metAdCommitment, feeIls, reason }
}

module.exports = { evaluateExit, EXIT_FEE_ILS, REVENUE_WAIVER_THRESHOLD_ILS }
