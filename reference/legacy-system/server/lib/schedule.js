const TIME_ZONE = "Asia/Jerusalem"

function getJerusalemDateTimeKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)

  const values = {}

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value
    }
  }

  return (
    `${values.year}-${values.month}-${values.day}` +
    `T${values.hour}:${values.minute}`
  )
}

function isPlatformClosed(state, date = new Date()) {
  const now = getJerusalemDateTimeKey(date)

  const closures =
    Array.isArray(state.closures)
      ? state.closures
      : []

  const currentClosure = closures.find((item) => {
    if (!item) return false
    if (item.active === false) return false
    if (!item.startsAt || !item.endsAt) return false

    return (
      now >= item.startsAt &&
      now < item.endsAt
    )
  })

  if (!currentClosure) {
    return {
      closed: false,
      reason: null,
      closureId: null,
      startsAt: null,
      endsAt: null,
    }
  }

  return {
    closed: true,
    reason: currentClosure.name || "המערכת סגורה כעת",
    closureId: currentClosure.id,
    startsAt: currentClosure.startsAt,
    endsAt: currentClosure.endsAt,
  }
}

module.exports = {
  isPlatformClosed,
  getJerusalemDateTimeKey,
  TIME_ZONE,
}