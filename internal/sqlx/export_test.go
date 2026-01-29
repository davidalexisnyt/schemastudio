package sqlx

import (
	"strings"
	"testing"

	"erd/internal/schema"
)

func TestExport_Postgres(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "users", Fields: []schema.Field{{ID: "f1", Name: "id", Type: "INT"}, {ID: "f2", Name: "name", Type: "TEXT"}}},
			{ID: "t2", Name: "posts", Fields: []schema.Field{{ID: "f3", Name: "id", Type: "INT"}, {ID: "f4", Name: "user_id", Type: "INT"}}},
		},
		Relationships: []schema.Relationship{
			{ID: "r1", SourceTableID: "t1", SourceFieldID: "f1", TargetTableID: "t2", TargetFieldID: "f4"},
		},
	}
	out, err := Export("postgres", d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "CREATE TABLE") {
		t.Errorf("expected CREATE TABLE in output: %s", out)
	}
	if !strings.Contains(out, "users") || !strings.Contains(out, "posts") {
		t.Errorf("expected table names in output: %s", out)
	}
}

func TestExport_BigQuery(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "users", Fields: []schema.Field{{ID: "f1", Name: "id", Type: "INT"}}},
		},
	}
	out, err := Export("bigquery", d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "CREATE TABLE") {
		t.Errorf("expected CREATE TABLE in output: %s", out)
	}
}

func TestExport_UnknownDialect(t *testing.T) {
	_, err := Export("unknown", schema.Diagram{})
	if err == nil {
		t.Fatal("expected error for unknown dialect")
	}
}
