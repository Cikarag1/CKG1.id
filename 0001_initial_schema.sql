PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY NOT NULL,
  item_code TEXT NOT NULL,
  name TEXT NOT NULL,
  supplier TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_price_rupiah INTEGER NOT NULL CHECK (unit_price_rupiah >= 0),
  purchase_qty_milli INTEGER NOT NULL CHECK (purchase_qty_milli >= 0),
  purchase_unit TEXT NOT NULL,
  stock_qty_milli INTEGER NOT NULL CHECK (stock_qty_milli >= 0),
  stock_unit TEXT NOT NULL,
  purchase_total_milli INTEGER NOT NULL CHECK (purchase_total_milli >= 0),
  inventory_value_milli INTEGER NOT NULL CHECK (inventory_value_milli >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_code_supplier
  ON items(lower(item_code), lower(supplier));
CREATE INDEX IF NOT EXISTS idx_items_name ON items(lower(name));
CREATE INDEX IF NOT EXISTS idx_items_supplier ON items(lower(supplier));
CREATE INDEX IF NOT EXISTS idx_items_category ON items(lower(category));
CREATE INDEX IF NOT EXISTS idx_items_price ON items(unit_price_rupiah);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_compare ON items(lower(name), lower(purchase_unit), unit_price_rupiah);

CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  old_price_rupiah INTEGER NOT NULL,
  new_price_rupiah INTEGER NOT NULL,
  old_supplier TEXT NOT NULL,
  new_supplier TEXT NOT NULL,
  old_unit TEXT NOT NULL,
  new_unit TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_history_item ON price_history(item_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(changed_at DESC);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  item_id TEXT,
  item_code TEXT,
  item_name TEXT,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
