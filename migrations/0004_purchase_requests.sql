CREATE TABLE IF NOT EXISTS purchase_requests (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  total_agorot INTEGER NOT NULL CHECK(total_agorot > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_requests (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES purchase_requests(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  subtotal_agorot INTEGER NOT NULL CHECK(subtotal_agorot > 0),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id,store_id)
);
CREATE INDEX IF NOT EXISTS idx_store_requests_store ON store_requests(store_id,created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_request_limits (
  identity_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_items (
  id TEXT PRIMARY KEY,
  store_request_id TEXT NOT NULL REFERENCES store_requests(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  unit_price_agorot INTEGER NOT NULL CHECK(unit_price_agorot >= 0)
);

-- Provider data is stored separately from contact requests. No card fields are kept here.
CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES purchase_requests(id),
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  amount_agorot INTEGER NOT NULL CHECK(amount_agorot > 0),
  currency TEXT NOT NULL DEFAULT 'ILS' CHECK(currency='ILS'),
  status TEXT NOT NULL CHECK(status IN ('created','pending','paid','failed','refunded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider,provider_session_id)
);
ALTER TABLE orders ADD COLUMN request_id TEXT REFERENCES purchase_requests(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_store ON orders(request_id,store_id);
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES payment_attempts(id),
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(provider,event_id)
);
