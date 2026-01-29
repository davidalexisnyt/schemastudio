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
