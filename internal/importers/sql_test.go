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
	d, err := ParseSQL(sql)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Tables) != 2 {
		t.Errorf("expected 2 tables, got %d", len(d.Tables))
	}
	if len(d.Relationships) != 1 {
		t.Errorf("expected 1 relationship, got %d", len(d.Relationships))
	}
}

func TestParseSQL_Empty(t *testing.T) {
	d, err := ParseSQL("")
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Tables) != 0 {
		t.Errorf("expected 0 tables, got %d", len(d.Tables))
	}
}
