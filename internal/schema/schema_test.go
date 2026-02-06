package schema

import (
	"encoding/json"
	"testing"
)

func TestDiagram_MarshalUnmarshal(t *testing.T) {
	d := Diagram{
		Version: 1,
		Tables: []Table{
			{ID: "t1", Name: "users", X: 0, Y: 0, Fields: []Field{{ID: "f1", Name: "id", Type: "INT"}}},
		},
		Relationships: []Relationship{
			{ID: "r1", SourceTableID: "t1", SourceFieldID: "f1", TargetTableID: "t2", TargetFieldID: "f2"},
		},
	}
	s, err := d.MarshalJSONString()
	if err != nil {
		t.Fatal(err)
	}
	var d2 Diagram
	if err := json.Unmarshal([]byte(s), &d2); err != nil {
		t.Fatal(err)
	}
	if d2.Version != d.Version || len(d2.Tables) != len(d.Tables) || len(d2.Relationships) != len(d.Relationships) {
		t.Errorf("round-trip: got %+v", d2)
	}
}

func TestToMermaid(t *testing.T) {
	d := Diagram{
		Version: 1,
		Tables: []Table{
			{ID: "t1", Name: "users", Fields: []Field{{ID: "f1", Name: "id", Type: "int"}}},
			{ID: "t2", Name: "posts", Fields: []Field{{ID: "f2", Name: "user_id", Type: "int"}}},
		},
		Relationships: []Relationship{
			{ID: "r1", SourceTableID: "t1", SourceFieldID: "f1", TargetTableID: "t2", TargetFieldID: "f2"},
		},
	}
	out := ToMermaid(d)
	if out == "" {
		t.Fatal("expected non-empty Mermaid output")
	}
}

func TestField_BackwardCompat_OldJSON(t *testing.T) {
	// Old JSON without length/precision/scale/typeOverrides should deserialize fine
	oldJSON := `{"id":"f1","name":"id","type":"int","nullable":false,"primaryKey":true}`
	var f Field
	if err := json.Unmarshal([]byte(oldJSON), &f); err != nil {
		t.Fatalf("failed to unmarshal old field JSON: %v", err)
	}
	if f.ID != "f1" || f.Name != "id" || f.Type != "int" {
		t.Errorf("basic fields: %+v", f)
	}
	if !f.PrimaryKey {
		t.Error("expected PrimaryKey=true")
	}
	// New fields should be nil/zero
	if f.Length != nil {
		t.Errorf("Length should be nil, got %v", f.Length)
	}
	if f.Precision != nil {
		t.Errorf("Precision should be nil, got %v", f.Precision)
	}
	if f.Scale != nil {
		t.Errorf("Scale should be nil, got %v", f.Scale)
	}
	if f.TypeOverrides != nil {
		t.Errorf("TypeOverrides should be nil, got %v", f.TypeOverrides)
	}
}

func TestField_NewJSON_RoundTrip(t *testing.T) {
	length := 15
	prec := 10
	scl := 2
	f := Field{
		ID:        "f1",
		Name:      "phone",
		Type:      "string",
		Length:    &length,
		Precision: &prec,
		Scale:     &scl,
		TypeOverrides: map[string]FieldTypeOverride{
			"postgres": {Type: "varchar(15)"},
			"bigquery": {Type: "STRING"},
		},
	}
	b, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var f2 Field
	if err := json.Unmarshal(b, &f2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if f2.Length == nil || *f2.Length != 15 {
		t.Errorf("Length round-trip: got %v", f2.Length)
	}
	if f2.Precision == nil || *f2.Precision != 10 {
		t.Errorf("Precision round-trip: got %v", f2.Precision)
	}
	if f2.Scale == nil || *f2.Scale != 2 {
		t.Errorf("Scale round-trip: got %v", f2.Scale)
	}
	if len(f2.TypeOverrides) != 2 {
		t.Errorf("TypeOverrides round-trip: got %v", f2.TypeOverrides)
	}
	if f2.TypeOverrides["postgres"].Type != "varchar(15)" {
		t.Errorf("postgres override: got %v", f2.TypeOverrides["postgres"])
	}
}

func TestField_Omitempty(t *testing.T) {
	// Fields without optional values should not emit those keys
	f := Field{ID: "f1", Name: "x", Type: "string"}
	b, _ := json.Marshal(f)
	s := string(b)
	for _, key := range []string{"length", "precision", "scale", "typeOverrides", "nullable", "primaryKey"} {
		if json.Valid(b) {
			var m map[string]interface{}
			json.Unmarshal(b, &m)
			if _, exists := m[key]; exists {
				t.Errorf("expected %q to be omitted from JSON: %s", key, s)
			}
		}
	}
}
