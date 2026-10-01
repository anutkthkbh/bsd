-- Link authenticated customers to purchase requests for account history.
ALTER TABLE purchase_requests ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_user_date ON purchase_requests(user_id,created_at DESC);
