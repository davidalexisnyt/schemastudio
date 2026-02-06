package importers

import "testing"

func TestParseSQL_Simple(t *testing.T) {
	sql := `
CREATE TABLE users (
  id INTEGER NOT NULL,
  name TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE posts (
  id INTEGER NOT NULL,
  user_id INTEGER,
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`
	catalog, err := ParseSQL(sql)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Tables) != 2 {
		t.Errorf("expected 2 tables, got %d", len(catalog.Tables))
	}
	if len(catalog.Relationships) != 1 {
		t.Errorf("expected 1 relationship, got %d", len(catalog.Relationships))
	}
}

func TestParseSQL_Empty(t *testing.T) {
	catalog, err := ParseSQL("")
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Tables) != 0 {
		t.Errorf("expected 0 tables, got %d", len(catalog.Tables))
	}
}

func TestParseSQL_NormalizesTypes(t *testing.T) {
	sql := `
CREATE TABLE contacts (
  id INTEGER NOT NULL PRIMARY KEY,
  phone VARCHAR(15) NOT NULL,
  balance NUMERIC(10,2),
  bio TEXT,
  created_at TIMESTAMP NOT NULL
);
`
	catalog, err := ParseSQL(sql)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Tables) != 1 {
		t.Fatalf("expected 1 table, got %d", len(catalog.Tables))
	}
	tbl := catalog.Tables[0]
	if tbl.Name != "contacts" {
		t.Fatalf("expected table 'contacts', got %q", tbl.Name)
	}

	// id: INTEGER -> "integer", PK, not nullable
	idF := tbl.Fields[0]
	if idF.Type != "integer" {
		t.Errorf("id.Type = %q, want 'integer'", idF.Type)
	}
	if !idF.PrimaryKey {
		t.Errorf("id should be PK")
	}
	if idF.Nullable {
		t.Errorf("id should NOT be nullable")
	}

	// phone: VARCHAR(15) -> "string", length=15
	phoneF := tbl.Fields[1]
	if phoneF.Type != "string" {
		t.Errorf("phone.Type = %q, want 'string'", phoneF.Type)
	}
	if phoneF.Length == nil || *phoneF.Length != 15 {
		t.Errorf("phone.Length = %v, want 15", phoneF.Length)
	}
	// Should have postgres override
	if phoneF.TypeOverrides == nil {
		t.Errorf("phone should have typeOverrides")
	} else if ov, ok := phoneF.TypeOverrides["postgres"]; !ok || ov.Type != "varchar(15)" {
		t.Errorf("phone.TypeOverrides[postgres] = %v, want 'varchar(15)'", ov)
	}

	// balance: NUMERIC(10,2) -> "numeric", precision=10, scale=2
	balF := tbl.Fields[2]
	if balF.Type != "numeric" {
		t.Errorf("balance.Type = %q, want 'numeric'", balF.Type)
	}
	if balF.Precision == nil || *balF.Precision != 10 {
		t.Errorf("balance.Precision = %v, want 10", balF.Precision)
	}
	if balF.Scale == nil || *balF.Scale != 2 {
		t.Errorf("balance.Scale = %v, want 2", balF.Scale)
	}

	// bio: TEXT -> "string", no length
	bioF := tbl.Fields[3]
	if bioF.Type != "string" {
		t.Errorf("bio.Type = %q, want 'string'", bioF.Type)
	}
	if bioF.Length != nil {
		t.Errorf("bio.Length = %v, want nil", bioF.Length)
	}

	// created_at: TIMESTAMP -> "timestamp"
	tsF := tbl.Fields[4]
	if tsF.Type != "timestamp" {
		t.Errorf("created_at.Type = %q, want 'timestamp'", tsF.Type)
	}
}
