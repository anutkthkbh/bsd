ALTER TABLE verification_challenges ADD COLUMN target TEXT NOT NULL DEFAULT '';
ALTER TABLE verification_challenges ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE verification_challenges ADD COLUMN salt TEXT NOT NULL DEFAULT '';
ALTER TABLE verification_challenges ADD COLUMN user_id TEXT REFERENCES users(id);

CREATE TABLE auth_rate_limits (
  identity_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TEXT NOT NULL
);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
