CREATE TABLE IF NOT EXISTS web_contract_requests (
 id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, access_hash TEXT NOT NULL,
 plan_id TEXT NOT NULL, catalog_version TEXT NOT NULL, plan_snapshot TEXT NOT NULL, request_json TEXT NOT NULL,
 initial_minor INTEGER NOT NULL CHECK(initial_minor>0), total_minor INTEGER NOT NULL CHECK(total_minor>=initial_minor),
 status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN('awaiting_payment','paid_review','approved','correction','refunded')),
 preference_id TEXT, init_point TEXT, payment_id TEXT UNIQUE, paid_at TEXT, gross_minor INTEGER, net_minor INTEGER,
 reviewed_at TEXT, reviewed_by TEXT, review_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS web_payment_events (
 payment_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
