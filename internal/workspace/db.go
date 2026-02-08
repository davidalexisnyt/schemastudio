package workspace

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// schemaSQL is the DDL executed when creating a new workspace database.
const schemaSQL = `
-- Workspace metadata (key-value for flexibility)
CREATE TABLE IF NOT EXISTS workspace_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- === TABLE CATALOG ===

CREATE TABLE IF NOT EXISTS catalog_tables (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_fields (
    id          TEXT PRIMARY KEY,
    table_id    TEXT NOT NULL REFERENCES catalog_tables(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    nullable    INTEGER NOT NULL DEFAULT 0,
    primary_key INTEGER NOT NULL DEFAULT 0,
    length      INTEGER,
    precision   INTEGER,
    scale       INTEGER,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS catalog_field_type_overrides (
    field_id      TEXT NOT NULL REFERENCES catalog_fields(id) ON DELETE CASCADE,
    dialect       TEXT NOT NULL,
    type_override TEXT NOT NULL,
    PRIMARY KEY (field_id, dialect)
);

CREATE TABLE IF NOT EXISTS catalog_relationships (
    id              TEXT PRIMARY KEY,
    source_table_id TEXT NOT NULL REFERENCES catalog_tables(id) ON DELETE CASCADE,
    target_table_id TEXT NOT NULL REFERENCES catalog_tables(id) ON DELETE CASCADE,
    name            TEXT,
    note            TEXT,
    cardinality     TEXT
);

CREATE TABLE IF NOT EXISTS catalog_relationship_fields (
    relationship_id TEXT NOT NULL REFERENCES catalog_relationships(id) ON DELETE CASCADE,
    source_field_id TEXT NOT NULL REFERENCES catalog_fields(id) ON DELETE CASCADE,
    target_field_id TEXT NOT NULL REFERENCES catalog_fields(id) ON DELETE CASCADE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (relationship_id, sort_order)
);

-- === DIAGRAMS ===

CREATE TABLE IF NOT EXISTS diagrams (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    version        INTEGER NOT NULL DEFAULT 1,
    viewport_zoom  REAL DEFAULT 1.0,
    viewport_pan_x REAL DEFAULT 0.0,
    viewport_pan_y REAL DEFAULT 0.0,
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS diagram_table_placements (
    id               TEXT PRIMARY KEY,
    diagram_id       TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    catalog_table_id TEXT NOT NULL REFERENCES catalog_tables(id) ON DELETE CASCADE,
    x                REAL NOT NULL DEFAULT 0,
    y                REAL NOT NULL DEFAULT 0,
    UNIQUE(diagram_id, catalog_table_id)
);

CREATE TABLE IF NOT EXISTS diagram_relationship_placements (
    id                       TEXT PRIMARY KEY,
    diagram_id               TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    catalog_relationship_id  TEXT NOT NULL REFERENCES catalog_relationships(id) ON DELETE CASCADE,
    label                    TEXT,
    UNIQUE(diagram_id, catalog_relationship_id)
);

CREATE TABLE IF NOT EXISTS diagram_notes (
    id         TEXT PRIMARY KEY,
    diagram_id TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    text       TEXT NOT NULL DEFAULT '',
    width      REAL,
    height     REAL
);

CREATE TABLE IF NOT EXISTS diagram_text_blocks (
    id           TEXT PRIMARY KEY,
    diagram_id   TEXT NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    x            REAL NOT NULL DEFAULT 0,
    y            REAL NOT NULL DEFAULT 0,
    text         TEXT NOT NULL DEFAULT '',
    width        REAL,
    height       REAL,
    font_size    REAL,
    use_markdown INTEGER NOT NULL DEFAULT 0
);

-- === CONNECTION PROFILES (workspace-scoped) ===

CREATE TABLE IF NOT EXISTS connection_profiles (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,
    driver              TEXT NOT NULL,
    host                TEXT,
    port                INTEGER,
    database_name       TEXT,
    username            TEXT,
    ssl_mode            TEXT,
    project             TEXT,
    dataset             TEXT,
    credentials_file    TEXT,
    bigquery_auth_mode  TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now'))
);

-- === UI STATE ===

CREATE TABLE IF NOT EXISTS ui_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Schema versioning for future migrations
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
`

// currentSchemaVersion is the latest schema version this code supports.
const currentSchemaVersion = 1

// OpenDB opens (or creates) a SQLite database at filePath and returns the
// connection. It enables foreign keys and WAL journal mode.
func OpenDB(filePath string) (*sql.DB, error) {
	// Ensure the parent directory exists.
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create directory: %w", err)
	}

	db, err := sql.Open("sqlite", filePath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Enable foreign keys.
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	// Use WAL journal mode for better concurrent read performance.
	if _, err := db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("set WAL mode: %w", err)
	}

	return db, nil
}

// InitSchema creates all tables if they do not already exist.
func InitSchema(db *sql.DB) error {
	if _, err := db.Exec(schemaSQL); err != nil {
		return fmt.Errorf("init schema: %w", err)
	}
	return nil
}

// MigrateSchema checks the current schema version and applies incremental
// migrations. Returns an error if the file version is newer than supported.
func MigrateSchema(db *sql.DB) error {
	var version int
	err := db.QueryRow("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").Scan(&version)
	if err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version > currentSchemaVersion {
		return fmt.Errorf("workspace file version %d is newer than supported version %d — please update Schema Studio", version, currentSchemaVersion)
	}
	// Future migrations go here, e.g.:
	// if version < 2 { applyMigrationV2(db); }
	return nil
}
