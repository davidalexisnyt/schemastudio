package sqlx

import (
	"strings"
	"testing"

	"schemastudio/internal/schema"
)

func intP(v int) *int { return &v }

func TestExport_Postgres(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "users", Fields: []schema.Field{
				{ID: "f1", Name: "id", Type: "integer", PrimaryKey: true},
				{ID: "f2", Name: "name", Type: "string"},
			}},
			{ID: "t2", Name: "posts", Fields: []schema.Field{
				{ID: "f3", Name: "id", Type: "integer", PrimaryKey: true},
				{ID: "f4", Name: "user_id", Type: "integer"},
			}},
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
	if !strings.Contains(out, "primary key") {
		t.Errorf("expected primary key in output: %s", out)
	}
}

func TestExport_Postgres_NullableAndPK(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "items", Fields: []schema.Field{
				{ID: "f1", Name: "id", Type: "integer", PrimaryKey: true},
				{ID: "f2", Name: "description", Type: "string", Nullable: true},
				{ID: "f3", Name: "price", Type: "numeric", Precision: intP(10), Scale: intP(2)},
			}},
		},
	}
	out, err := Export("postgres", d)
	if err != nil {
		t.Fatal(err)
	}
	// id should be not null
	if !strings.Contains(out, "id integer not null") {
		t.Errorf("id should be 'integer not null': %s", out)
	}
	// description should NOT have 'not null' since it's nullable
	if strings.Contains(out, "description text not null") {
		t.Errorf("description should not be 'not null': %s", out)
	}
	// price should have numeric(10,2)
	if !strings.Contains(out, "numeric(10,2)") {
		t.Errorf("expected numeric(10,2) in output: %s", out)
	}
	// PK clause
	if !strings.Contains(out, "primary key (id)") {
		t.Errorf("expected primary key (id) in output: %s", out)
	}
}

func TestExport_Postgres_TypeOverride(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "t", Fields: []schema.Field{
				{ID: "f1", Name: "phone", Type: "string", Length: intP(15),
					TypeOverrides: map[string]schema.FieldTypeOverride{
						"postgres": {Type: "citext"},
					}},
			}},
		},
	}
	out, err := Export("postgres", d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "citext") {
		t.Errorf("expected override 'citext' in output: %s", out)
	}
}

func TestExport_Postgres_LengthField(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "t", Fields: []schema.Field{
				{ID: "f1", Name: "code", Type: "string", Length: intP(10)},
			}},
		},
	}
	out, err := Export("postgres", d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "varchar(10)") {
		t.Errorf("expected varchar(10) in output: %s", out)
	}
}

func TestExport_BigQuery(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "users", Fields: []schema.Field{{ID: "f1", Name: "id", Type: "integer"}}},
		},
	}
	out, err := Export("bigquery", d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "create table") {
		t.Errorf("expected create table in output: %s", out)
	}
	if !strings.Contains(out, "INT64") {
		t.Errorf("expected INT64 in output: %s", out)
	}
}

func TestExportBigQueryWithTarget(t *testing.T) {
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "users", Fields: []schema.Field{{ID: "f1", Name: "id", Type: "integer"}}},
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
			{ID: "t1", Name: "users", Fields: []schema.Field{{ID: "f1", Name: "id", Type: "integer"}}},
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

func TestExport_BackwardCompat_OldTypes(t *testing.T) {
	// Simulate an old diagram with platform-specific types; exporters should still work
	d := schema.Diagram{
		Version: 1,
		Tables: []schema.Table{
			{ID: "t1", Name: "legacy", Fields: []schema.Field{
				{ID: "f1", Name: "id", Type: "int"},
				{ID: "f2", Name: "name", Type: "text"},
				{ID: "f3", Name: "val", Type: "bigint"},
			}},
		},
	}
	out, err := Export("postgres", d)
	if err != nil {
		t.Fatal(err)
	}
	// Should still produce valid DDL even with old types
	if !strings.Contains(out, "create table") {
		t.Errorf("expected create table for old types: %s", out)
	}
}

