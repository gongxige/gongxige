export const PLATFORM_SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    password_salt TEXT,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    login_locked_until TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallets (
    player_id TEXT PRIMARY KEY REFERENCES players(id),
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    frozen_balance INTEGER NOT NULL DEFAULT 0 CHECK (frozen_balance >= 0),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deposit_requests (
    id TEXT PRIMARY KEY,
    request_no TEXT NOT NULL UNIQUE,
    player_id TEXT NOT NULL REFERENCES players(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id TEXT PRIMARY KEY,
    request_no TEXT NOT NULL UNIQUE,
    player_id TEXT NOT NULL REFERENCES players(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE,
    player_id TEXT NOT NULL REFERENCES players(id),
    kind TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    balance_delta INTEGER NOT NULL,
    frozen_delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
    frozen_after INTEGER NOT NULL CHECK (frozen_after >= 0),
    status TEXT NOT NULL DEFAULT 'completed',
    round_id TEXT,
    request_id TEXT,
    ref_transaction_id TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_transactions (
    transaction_id TEXT PRIMARY KEY,
    operation TEXT NOT NULL CHECK (operation IN ('bet', 'win', 'refund', 'balance')),
    player_id TEXT NOT NULL REFERENCES players(id),
    round_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled')),
    ledger_entry_id TEXT REFERENCES ledger_entries(id),
    ref_transaction_id TEXT,
    request_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ledger_entries_player_created_at
    ON ledger_entries(player_id, created_at);
  CREATE INDEX IF NOT EXISTS withdrawal_requests_player_status
    ON withdrawal_requests(player_id, status);
`;
