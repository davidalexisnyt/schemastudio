package sqlx

import (
	"fmt"
	"testing"

	"schemastudio/internal/schema"
)

// --- NormalizeType tests ---

func TestNormalizeType_Strings(t *testing.T) {
	cases := []struct {
		raw     string
		wantT   string
		wantLen *int
	}{
		{"varchar", "string", nil},
		{"VARCHAR(255)", "string", intPtr(255)},
		{"varchar(15)", "string", intPtr(15)},
		{"character varying(100)", "string", intPtr(100)},
		{"text", "string", nil},
		{"STRING", "string", nil},
		{"nvarchar(50)", "string", intPtr(50)},
		{"char(1)", "string", intPtr(1)},
		{"CLOB", "string", nil},
		{"", "string", nil},
	}
	for _, c := range cases {
		gt, l, p, s := NormalizeType(c.raw)
		if gt != c.wantT {
			t.Errorf("NormalizeType(%q) type = %q, want %q", c.raw, gt, c.wantT)
		}
		if !intPtrEq(l, c.wantLen) {
			t.Errorf("NormalizeType(%q) length = %v, want %v", c.raw, ptrVal(l), ptrVal(c.wantLen))
		}
		if p != nil || s != nil {
			t.Errorf("NormalizeType(%q) precision/scale should be nil", c.raw)
		}
	}
}

func TestNormalizeType_Integers(t *testing.T) {
	cases := []string{"int", "INTEGER", "bigint", "SMALLINT", "INT8", "SERIAL", "INT64", "tinyint", "MEDIUMINT"}
	for _, raw := range cases {
		gt, l, p, s := NormalizeType(raw)
		if gt != "integer" {
			t.Errorf("NormalizeType(%q) = %q, want 'integer'", raw, gt)
		}
		if l != nil || p != nil || s != nil {
			t.Errorf("NormalizeType(%q) dimensions should be nil", raw)
		}
	}
}

func TestNormalizeType_Floats(t *testing.T) {
	cases := []string{"float", "REAL", "double", "DOUBLE PRECISION", "FLOAT64", "MONEY"}
	for _, raw := range cases {
		gt, _, _, _ := NormalizeType(raw)
		if gt != "float" {
			t.Errorf("NormalizeType(%q) = %q, want 'float'", raw, gt)
		}
	}
}

func TestNormalizeType_Numeric(t *testing.T) {
	cases := []struct {
		raw   string
		wantP *int
		wantS *int
	}{
		{"numeric", nil, nil},
		{"NUMERIC(10,2)", intPtr(10), intPtr(2)},
		{"decimal(5)", intPtr(5), nil},
		{"DECIMAL(18,4)", intPtr(18), intPtr(4)},
	}
	for _, c := range cases {
		gt, _, p, s := NormalizeType(c.raw)
		if gt != "numeric" {
			t.Errorf("NormalizeType(%q) type = %q, want 'numeric'", c.raw, gt)
		}
		if !intPtrEq(p, c.wantP) {
			t.Errorf("NormalizeType(%q) precision = %v, want %v", c.raw, ptrVal(p), ptrVal(c.wantP))
		}
		if !intPtrEq(s, c.wantS) {
			t.Errorf("NormalizeType(%q) scale = %v, want %v", c.raw, ptrVal(s), ptrVal(c.wantS))
		}
	}
}

func TestNormalizeType_Other(t *testing.T) {
	cases := map[string]string{
		"boolean":                  "boolean",
		"BOOL":                     "boolean",
		"BIT":                      "boolean",
		"date":                     "date",
		"DATE":                     "date",
		"time":                     "time",
		"TIME WITH TIME ZONE":      "time",
		"timestamp":                "timestamp",
		"DATETIME":                 "timestamp",
		"DATETIME2":                "timestamp",
		"TIMESTAMPTZ":              "timestamp",
		"uuid":                     "uuid",
		"UNIQUEIDENTIFIER":         "uuid",
		"json":                     "json",
		"JSONB":                    "json",
		"bytea":                    "bytes",
		"BLOB":                     "bytes",
		"VARBINARY":                "bytes",
		"INTERVAL":                 "string",
	}
	for raw, want := range cases {
		gt, _, _, _ := NormalizeType(raw)
		if gt != want {
			t.Errorf("NormalizeType(%q) = %q, want %q", raw, gt, want)
		}
	}
}

func TestNormalizeType_Unknown(t *testing.T) {
	gt, _, _, _ := NormalizeType("geometry")
	if gt != "other" {
		t.Errorf("NormalizeType('geometry') = %q, want 'other'", gt)
	}
}

// --- DefaultExportType tests ---

func TestDefaultExportType_Postgres(t *testing.T) {
	cases := []struct {
		gt   string
		len  *int
		prec *int
		scl  *int
		want string
	}{
		{"string", nil, nil, nil, "text"},
		{"string", intPtr(100), nil, nil, "varchar(100)"},
		{"integer", nil, nil, nil, "integer"},
		{"float", nil, nil, nil, "double precision"},
		{"numeric", nil, intPtr(10), intPtr(2), "numeric(10,2)"},
		{"numeric", nil, nil, nil, "numeric"},
		{"boolean", nil, nil, nil, "boolean"},
		{"date", nil, nil, nil, "date"},
		{"time", nil, nil, nil, "time"},
		{"timestamp", nil, nil, nil, "timestamp"},
		{"uuid", nil, nil, nil, "uuid"},
		{"json", nil, nil, nil, "jsonb"},
		{"bytes", nil, nil, nil, "bytea"},
	}
	for _, c := range cases {
		got := DefaultExportType("postgres", c.gt, c.len, c.prec, c.scl, nil)
		if got != c.want {
			t.Errorf("DefaultExportType('postgres', %q, %v, %v, %v) = %q, want %q",
				c.gt, ptrVal(c.len), ptrVal(c.prec), ptrVal(c.scl), got, c.want)
		}
	}
}

func TestDefaultExportType_MySQL(t *testing.T) {
	got := DefaultExportType("mysql", "boolean", nil, nil, nil, nil)
	if got != "tinyint(1)" {
		t.Errorf("MySQL boolean = %q, want 'tinyint(1)'", got)
	}
	got = DefaultExportType("mysql", "uuid", nil, nil, nil, nil)
	if got != "char(36)" {
		t.Errorf("MySQL uuid = %q, want 'char(36)'", got)
	}
	got = DefaultExportType("mysql", "timestamp", nil, nil, nil, nil)
	if got != "datetime" {
		t.Errorf("MySQL timestamp = %q, want 'datetime'", got)
	}
}

func TestDefaultExportType_MSSQL(t *testing.T) {
	got := DefaultExportType("mssql", "string", nil, nil, nil, nil)
	if got != "nvarchar(max)" {
		t.Errorf("MSSQL string = %q, want 'nvarchar(max)'", got)
	}
	got = DefaultExportType("mssql", "string", intPtr(50), nil, nil, nil)
	if got != "nvarchar(50)" {
		t.Errorf("MSSQL string(50) = %q, want 'nvarchar(50)'", got)
	}
	got = DefaultExportType("mssql", "uuid", nil, nil, nil, nil)
	if got != "uniqueidentifier" {
		t.Errorf("MSSQL uuid = %q, want 'uniqueidentifier'", got)
	}
}

func TestDefaultExportType_BigQuery(t *testing.T) {
	cases := map[string]string{
		"string":    "STRING",
		"integer":   "INT64",
		"float":     "FLOAT64",
		"numeric":   "NUMERIC",
		"boolean":   "BOOL",
		"date":      "DATE",
		"time":      "TIME",
		"timestamp": "TIMESTAMP",
		"uuid":      "STRING",
		"json":      "JSON",
		"bytes":     "BYTES",
	}
	for gt, want := range cases {
		got := DefaultExportType("bigquery", gt, nil, nil, nil, nil)
		if got != want {
			t.Errorf("DefaultExportType('bigquery', %q) = %q, want %q", gt, got, want)
		}
	}
}

func TestDefaultExportType_Override(t *testing.T) {
	overrides := map[string]schema.FieldTypeOverride{
		"postgres": {Type: "citext"},
	}
	got := DefaultExportType("postgres", "string", nil, nil, nil, overrides)
	if got != "citext" {
		t.Errorf("override: got %q, want 'citext'", got)
	}
	// Other dialects should still use default
	got = DefaultExportType("mysql", "string", nil, nil, nil, overrides)
	if got != "text" {
		t.Errorf("non-overridden MySQL: got %q, want 'text'", got)
	}
}

// --- helpers ---

func intPtr(v int) *int { return &v }

func intPtrEq(a, b *int) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func ptrVal(p *int) string {
	if p == nil {
		return "nil"
	}
	return fmt.Sprintf("%d", *p)
}
