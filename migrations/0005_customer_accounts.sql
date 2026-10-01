PRAGMA foreign_keys = OFF;

ALTER TABLE sessions RENAME TO sessions_legacy;
ALTER TABLE users RENAME TO users_legacy;
DROP INDEX IF EXISTS idx_sessions_expiry;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','merchant','customer')),
  store_id TEXT REFERENCES stores(id),
  password_salt TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (role='merchant' AND store_id IS NOT NULL) OR
    (role IN ('admin','customer') AND store_id IS NULL)
  )
);

INSERT INTO users(id,email,name,role,store_id,password_salt,password_hash,created_at)
SELECT id,email,name,role,store_id,password_salt,password_hash,created_at FROM users_legacy;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at)
SELECT id,user_id,token_hash,expires_at,created_at FROM sessions_legacy;

DROP TABLE sessions_legacy;
DROP TABLE users_legacy;
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE customer_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0,1)),
  phone_verified INTEGER NOT NULL DEFAULT 0 CHECK(phone_verified IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('password','google','email_code','sms_code')),
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider,provider_subject)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);

INSERT INTO auth_identities(id,user_id,provider,provider_subject)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
       id,'password',lower(email)
FROM users
WHERE password_hash<>'';

CREATE TABLE verification_challenges (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
  destination_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('login','verify')),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_verification_destination ON verification_challenges(destination_hash,created_at DESC);

PRAGMA foreign_keys = ON;
