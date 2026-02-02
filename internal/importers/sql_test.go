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
