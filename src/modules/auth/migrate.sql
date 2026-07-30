-- Run this once against your database before deploying the new auth system.
-- All statements are idempotent (safe to re-run).

-- ── NextAuth core tables (pg-adapter) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT,
  email         TEXT        NOT NULL,
  "emailVerified" TIMESTAMPTZ,
  image         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE TABLE IF NOT EXISTS accounts (
  id                   UUID  NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "userId"             UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                 TEXT  NOT NULL,
  provider             TEXT  NOT NULL,
  "providerAccountId"  TEXT  NOT NULL,
  refresh_token        TEXT,
  access_token         TEXT,
  expires_at           INTEGER,
  token_type           TEXT,
  scope                TEXT,
  id_token             TEXT,
  session_state        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_key ON accounts (provider, "providerAccountId");

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "sessionToken" TEXT       NOT NULL,
  "userId"      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires       TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_key ON sessions ("sessionToken");

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT        NOT NULL,
  token      TEXT        NOT NULL,
  expires    TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS vt_token_key ON verification_tokens (token);

-- ── Password column (our addition) ───────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ── OTP table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS verification_otps (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT        NOT NULL,
  otp_hash   TEXT        NOT NULL,
  purpose    TEXT        NOT NULL CHECK (purpose IN ('signup', 'password_reset')),
  attempts   INTEGER     NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vot_email_purpose ON verification_otps (email, purpose);
