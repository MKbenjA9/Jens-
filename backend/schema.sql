PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  reference_image TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patterns (
  id INTEGER PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'mm' CHECK (unit = 'mm'),
  geometry_json TEXT NOT NULL DEFAULT '{"pieces":[]}',
  code TEXT NOT NULL DEFAULT '',
  garment_type TEXT NOT NULL DEFAULT '',
  pattern_kind TEXT NOT NULL DEFAULT 'base' CHECK (pattern_kind IN ('base', 'variant')),
  family_id INTEGER REFERENCES pattern_families(id) ON DELETE SET NULL,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  variant_of_id INTEGER REFERENCES patterns(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pattern_families (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS pattern_products (
  pattern_id INTEGER NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pattern_id, product_id)
);

CREATE TABLE IF NOT EXISTS pattern_versions (
  id INTEGER PRIMARY KEY,
  pattern_id INTEGER NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (pattern_id, version)
);

CREATE TABLE IF NOT EXISTS sizes (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, name)
);

CREATE TABLE IF NOT EXISTS measurement_definitions (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tolerance_cm REAL CHECK (tolerance_cm IS NULL OR tolerance_cm >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, name)
);

CREATE TABLE IF NOT EXISTS size_measurements (
  size_id INTEGER NOT NULL REFERENCES sizes(id) ON DELETE CASCADE,
  measurement_id INTEGER NOT NULL REFERENCES measurement_definitions(id) ON DELETE CASCADE,
  value_cm REAL CHECK (value_cm IS NULL OR value_cm >= 0),
  PRIMARY KEY (size_id, measurement_id)
);

CREATE TABLE IF NOT EXISTS scaling_rules (
  id INTEGER PRIMARY KEY,
  measurement_id INTEGER NOT NULL REFERENCES measurement_definitions(id) ON DELETE CASCADE,
  from_size_id INTEGER NOT NULL REFERENCES sizes(id) ON DELETE CASCADE,
  to_size_id INTEGER NOT NULL REFERENCES sizes(id) ON DELETE CASCADE,
  increment_cm REAL NOT NULL,
  UNIQUE (measurement_id, from_size_id, to_size_id),
  CHECK (from_size_id <> to_size_id)
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  composition TEXT NOT NULL DEFAULT '',
  width_mm REAL,
  supplier TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'm',
  unit_price REAL CHECK (unit_price IS NULL OR unit_price >= 0),
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS product_materials (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  quantity REAL CHECK (quantity IS NULL OR quantity >= 0),
  quantity_kind TEXT NOT NULL DEFAULT 'manual' CHECK (quantity_kind IN ('manual', 'estimated')),
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (product_id, material_id)
);

CREATE TABLE IF NOT EXISTS technical_sheets (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('construction', 'measurement')),
  version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, kind, version)
);

CREATE TABLE IF NOT EXISTS sheet_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_history (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patterns_product ON patterns(product_id);
CREATE INDEX IF NOT EXISTS idx_pattern_versions_pattern ON pattern_versions(pattern_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_sizes_product ON sizes(product_id);
CREATE INDEX IF NOT EXISTS idx_measurements_product ON measurement_definitions(product_id);
CREATE INDEX IF NOT EXISTS idx_sheets_product ON technical_sheets(product_id);
CREATE INDEX IF NOT EXISTS idx_history_product ON product_history(product_id, created_at DESC);
