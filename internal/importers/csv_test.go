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
