CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('operator', 'admin', 'techadmin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS daily_sequences (
    business_date DATE PRIMARY KEY,
    next_value INTEGER NOT NULL CHECK (next_value > 0)
);

CREATE TABLE IF NOT EXISTS import_batches (
    id UUID PRIMARY KEY,
    filename TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    imported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_rows INTEGER NOT NULL DEFAULT 0,
    inserted_rows INTEGER NOT NULL DEFAULT 0,
    skipped_rows INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS weighings (
    id BIGSERIAL PRIMARY KEY,
    receipt_no TEXT NOT NULL UNIQUE,
    plate_number TEXT NOT NULL,
    plate_search TEXT NOT NULL,
    price BIGINT NOT NULL CHECK (price >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    business_date DATE NOT NULL,
    paid_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'bank')),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'web',
    legacy_id BIGINT,
    legacy_receipt_no TEXT,
    legacy_fingerprint TEXT UNIQUE,
    import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL
);

ALTER TABLE weighings ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';

CREATE INDEX IF NOT EXISTS idx_weighings_created_at ON weighings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weighings_business_date ON weighings (business_date DESC);
CREATE INDEX IF NOT EXISTS idx_weighings_status_date ON weighings (status, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_weighings_plate_search ON weighings (plate_search);
CREATE INDEX IF NOT EXISTS idx_weighings_created_by ON weighings (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS backup_tokens (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS login_attempts (
    identifier TEXT PRIMARY KEY,
    failure_count INTEGER NOT NULL DEFAULT 0,
    first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    blocked_until TIMESTAMPTZ
);
