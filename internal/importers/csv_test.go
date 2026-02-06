package importers

import "testing"

func TestParseCSV_Simple(t *testing.T) {
	csv := `schema,table,column,type,is_nullable,field_order
public,users,id,int64,no,1
public,users,name,string,yes,2
public,posts,id,int64,no,1
public,posts,user_id,int64,yes,2
`
	catalog, err := ParseCSV(csv)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Tables) != 2 {
		t.Errorf("expected 2 tables, got %d", len(catalog.Tables))
	}
	if len(catalog.Relationships) != 0 {
		t.Errorf("expected 0 relationships, got %d", len(catalog.Relationships))
	}
	if catalog.Tables[0].Name != "posts" && catalog.Tables[0].Name != "users" {
		t.Errorf("unexpected table name %q", catalog.Tables[0].Name)
	}
	// Tables are sorted by name, so posts first then users
	if len(catalog.Tables[0].Fields) != 2 {
		t.Errorf("expected 2 fields in first table, got %d", len(catalog.Tables[0].Fields))
	}
	if len(catalog.Tables[1].Fields) != 2 {
		t.Errorf("expected 2 fields in second table, got %d", len(catalog.Tables[1].Fields))
	}
}

func TestParseCSV_Empty(t *testing.T) {
	catalog, err := ParseCSV("")
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Tables) != 0 {
		t.Errorf("expected 0 tables, got %d", len(catalog.Tables))
	}
}

func TestParseCSV_HeaderOnly(t *testing.T) {
	csv := "schema,table,column,type,is_nullable,field_order\n"
	catalog, err := ParseCSV(csv)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Tables) != 0 {
		t.Errorf("expected 0 tables, got %d", len(catalog.Tables))
	}
}

func TestParseCSV_NormalizesTypes(t *testing.T) {
	csv := `table,column,type,is_nullable,field_order
users,id,INT64,no,1
users,name,VARCHAR(100),yes,2
users,balance,"NUMERIC(10,2)",yes,3
users,active,BOOLEAN,no,4
`
	catalog, err := ParseCSV(csv)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Tables) != 1 {
		t.Fatalf("expected 1 table, got %d", len(catalog.Tables))
	}
	fields := catalog.Tables[0].Fields
	if fields[0].Type != "integer" {
		t.Errorf("INT64 -> %q, want 'integer'", fields[0].Type)
	}
	if fields[1].Type != "string" {
		t.Errorf("VARCHAR(100) -> %q, want 'string'", fields[1].Type)
	}
	if fields[1].Length == nil || *fields[1].Length != 100 {
		t.Errorf("VARCHAR(100) length = %v, want 100", fields[1].Length)
	}
	if fields[2].Type != "numeric" {
		t.Errorf("NUMERIC(10,2) -> %q, want 'numeric'", fields[2].Type)
	}
	if fields[2].Precision == nil || *fields[2].Precision != 10 {
		t.Errorf("NUMERIC precision = %v, want 10", fields[2].Precision)
	}
	if fields[2].Scale == nil || *fields[2].Scale != 2 {
		t.Errorf("NUMERIC scale = %v, want 2", fields[2].Scale)
	}
	if fields[3].Type != "boolean" {
		t.Errorf("BOOLEAN -> %q, want 'boolean'", fields[3].Type)
	}
}
