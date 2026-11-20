from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "patronaje.db"


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize() -> None:
    with connect() as db:
        db.executescript((ROOT / "backend" / "schema.sql").read_text(encoding="utf-8"))
        columns = {row["name"]: row for row in db.execute("PRAGMA table_info(patterns)")}
        for name, declaration in {
            "code": "TEXT NOT NULL DEFAULT ''",
            "garment_type": "TEXT NOT NULL DEFAULT ''",
            "pattern_kind": "TEXT NOT NULL DEFAULT 'base'",
            "family_id": "INTEGER REFERENCES pattern_families(id) ON DELETE SET NULL",
            "favorite": "INTEGER NOT NULL DEFAULT 0",
            "variant_of_id": "INTEGER REFERENCES patterns(id) ON DELETE SET NULL",
        }.items():
            if name not in columns:
                db.execute(f"ALTER TABLE patterns ADD COLUMN {name} {declaration}")
        db.execute("INSERT OR IGNORE INTO pattern_products (pattern_id, product_id) SELECT id, product_id FROM patterns WHERE product_id IS NOT NULL")
        db.execute("CREATE INDEX IF NOT EXISTS idx_patterns_family ON patterns(family_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_pattern_products_product ON pattern_products(product_id)")
        product_fk = next(row for row in db.execute("PRAGMA foreign_key_list(patterns)") if row["from"] == "product_id")
        if columns["product_id"]["notnull"] or product_fk["on_delete"].upper() != "SET NULL":
            db.execute("PRAGMA foreign_keys = OFF")
            db.executescript("""
                BEGIN;
                CREATE TABLE patterns_new (
                  id INTEGER PRIMARY KEY,
                  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                  name TEXT NOT NULL,
                  unit TEXT NOT NULL DEFAULT 'mm' CHECK (unit = 'mm'),
                  geometry_json TEXT NOT NULL DEFAULT '{"pieces":[]}',
                  code TEXT NOT NULL DEFAULT '',
                  garment_type TEXT NOT NULL DEFAULT '',
                  pattern_kind TEXT NOT NULL DEFAULT 'base' CHECK (pattern_kind IN ('base', 'variant')),
                  family_id INTEGER REFERENCES pattern_families(id) ON DELETE SET NULL,
                  favorite INTEGER NOT NULL DEFAULT 0,
                  variant_of_id INTEGER REFERENCES patterns(id) ON DELETE SET NULL,
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO patterns_new (id, product_id, name, unit, geometry_json, code, garment_type, pattern_kind, family_id, favorite, variant_of_id, created_at, updated_at)
                SELECT id, product_id, name, unit, geometry_json, code, garment_type, pattern_kind, family_id, favorite, variant_of_id, created_at, updated_at FROM patterns;
                DROP TABLE patterns;
                ALTER TABLE patterns_new RENAME TO patterns;
                COMMIT;
            """)
            db.execute("PRAGMA foreign_keys = ON")
            db.execute("CREATE INDEX IF NOT EXISTS idx_patterns_product ON patterns(product_id)")
