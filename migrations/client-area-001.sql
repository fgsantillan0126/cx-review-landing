CREATE TABLE IF NOT EXISTS client_reports (
 order_id TEXT PRIMARY KEY, reference TEXT NOT NULL, revision INTEGER NOT NULL,
 content_json TEXT NOT NULL, executive_html TEXT NOT NULL, prepared_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 client_id TEXT, released_at TEXT, released_by TEXT,
 CHECK ((client_id IS NULL AND released_at IS NULL) OR (client_id IS NOT NULL AND released_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS client_reports_owner ON client_reports(client_id,released_at);
CREATE TABLE IF NOT EXISTS client_access (
 token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TEXT NOT NULL, revoked_at TEXT, created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS client_area_history (
 id TEXT PRIMARY KEY, order_id TEXT, action TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
