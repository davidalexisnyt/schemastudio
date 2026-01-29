package importers

import (
	"testing"
)

func TestParseMermaid_Simple(t *testing.T) {
	mm := `
erDiagram
    users {
        int id
        string name
    }
    posts {
        int id
        int user_id
    }
    users ||--o{ posts : ""
`
	d, err := ParseMermaid(mm)
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
