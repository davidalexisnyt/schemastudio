package sqlx

import (
	"strings"
	"testing"

	"schemastudio/internal/schema"
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
	if !strings.Contains(out, "create table") {
		t.Errorf("expected create table in output: %s", out)
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
	if !strings.Contains(out, "create table") {
		t.Errorf("expected create table in output: %s", out)
	}
}

func TestExportBigQueryWithTarget(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "users", Fields: []schema.Field{{ID: "f1", Name: "id", Type: "INT"}}},
		},
	}
	out, err := ExportBigQueryWithTarget(d, "my-project", "my_dataset", "")
	if err != nil {
		t.Fatal(err)
	}
	want := "create table my-project.my_dataset.users"
	if !strings.Contains(out, want) {
		t.Errorf("expected qualified table name %q in output: %s", want, out)
	}
}

func TestExportBigQueryWithTarget_CreationMode(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "users", Fields: []schema.Field{{ID: "f1", Name: "id", Type: "INT"}}},
		},
	}
	out, err := ExportBigQueryWithTarget(d, "p", "d", "create_or_replace")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "create or replace table ") {
		t.Errorf("expected create or replace table in output: %s", out)
	}
	out2, err := ExportBigQueryWithTarget(d, "p", "d", "if_not_exists")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out2, "create table if not exists ") {
		t.Errorf("expected create table if not exists in output: %s", out2)
	}
}

func TestExport_UnknownDialect(t *testing.T) {
	_, err := Export("unknown", schema.Diagram{})
	if err == nil {
		t.Fatal("expected error for unknown dialect")
	}
}
