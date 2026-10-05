// customerValidation.js — פונקציה מרכזית לבדיקת שלמות פרופיל לקוח לפני תשלום.
// כל נקודה קריטית (checkout-readiness, prepare, ProfileCompletion ב-UI) משתמשת באותה רשימה.

const REQUIRED_CUSTOMER_FIELDS = ["name", "email", "phone", "city", "address", "zip"]

function getMissingCustomerFields(customer) {
  if (!customer) return [...REQUIRED_CUSTOMER_FIELDS]
  return REQUIRED_CUSTOMER_FIELDS.filter((field) => !String(customer[field] || "").trim())
}

// Snapshot קפוא של פרטי הלקוח, מוטבע בהזמנה ואינו מושפע מעדכוני פרופיל מאוחרים יותר.
function buildCustomerSnapshot(customer) {
  return {
    customerId: customer.id,
    name: customer.name || "",
    email: customer.email || "",
    phone: customer.phone || "",
    phone2: customer.phone2 || "",
    city: customer.city || "",
    address: customer.address || "",
    zip: customer.zip || "",
  }
}

module.exports = { REQUIRED_CUSTOMER_FIELDS, getMissingCustomerFields, buildCustomerSnapshot }
