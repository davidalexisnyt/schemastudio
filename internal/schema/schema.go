package schema

import (
	"encoding/json"
	"fmt"
)

// Diagram is the root document for save/load and import/export.
type Diagram struct {
	Version       int            `json:"version"`
	Tables        []Table        `json:"tables"`
	Relationships []Relationship `json:"relationships"`
	Viewport      *Viewport      `json:"viewport,omitempty"`
}

// TableCatalog is the result of an import (SQL, CSV, etc.). Used to populate
// the workspace table catalog or a standalone diagram.
type TableCatalog struct {
	ImportSource   string         `json:"importSource"` // File name the catalog was imported from.
	Tables         []Table        `json:"tables"`
	Relationships   []Relationship `json:"relationships"`
}

// Table represents a table on the canvas.
type Table struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Fields []Field `json:"fields"`
}

// FieldTypeOverride holds a per-database type override for a field.
type FieldTypeOverride struct {
	Type string `json:"type"`
}

// Field is a column in a table.
type Field struct {
	ID            string                       `json:"id"`
	Name          string                       `json:"name"`
	Type          string                       `json:"type"`
	Nullable      bool                         `json:"nullable,omitempty"`
	PrimaryKey    bool                         `json:"primaryKey,omitempty"`
	Length        *int                         `json:"length,omitempty"`
	Precision     *int                         `json:"precision,omitempty"`
	Scale         *int                         `json:"scale,omitempty"`
	TypeOverrides map[string]FieldTypeOverride `json:"typeOverrides,omitempty"`
}

// Relationship links source field(s) to target field(s).
type Relationship struct {
	ID              string   `json:"id"`
	SourceTableID   string   `json:"sourceTableId"`
	SourceFieldID   string   `json:"sourceFieldId"`
	TargetTableID   string   `json:"targetTableId"`
	TargetFieldID   string   `json:"targetFieldId"`
	Label           string   `json:"label,omitempty"`
	SourceFieldIDs  []string `json:"sourceFieldIds,omitempty"`
	TargetFieldIDs  []string `json:"targetFieldIds,omitempty"`
	Name            string   `json:"name,omitempty"`
	Note            string   `json:"note,omitempty"`
	Cardinality     string   `json:"cardinality,omitempty"`
}

// Viewport stores pan/zoom state.
type Viewport struct {
	Zoom float64 `json:"zoom"`
	PanX float64 `json:"panX"`
	PanY float64 `json:"panY"`
}

const CurrentVersion = 1

// NewDiagram returns an empty diagram at current version.
func NewDiagram() Diagram {
	return Diagram{
		Version:       CurrentVersion,
		Tables:        nil,
		Relationships: nil,
		Viewport:      nil,
	}
}

// MarshalJSONString returns the diagram as JSON string for frontend.
func (d Diagram) MarshalJSONString() (string, error) {
	b, err := json.Marshal(d)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ToMermaid outputs Mermaid ERD syntax from the diagram.
func ToMermaid(d Diagram) string {
	var out string
	out = "erDiagram\n"
	tblByID := make(map[string]string)
	for _, t := range d.Tables {
		tblByID[t.ID] = t.Name
	}
	for _, t := range d.Tables {
		out += "    " + t.Name + " {\n"
		for _, f := range t.Fields {
			out += "        " + f.Type + " " + f.Name + "\n"
		}
		out += "    }\n"
	}
	for _, r := range d.Relationships {
		src := tblByID[r.SourceTableID]
		tgt := tblByID[r.TargetTableID]
		if src == "" {
			src = r.SourceTableID
		}
		if tgt == "" {
			tgt = r.TargetTableID
		}
		out += "    " + src + " ||--o{ " + tgt + " : \"\"\n"
	}
	return out
}

// ToPlantUML outputs PlantUML entity-relationship diagram syntax from the diagram.
func ToPlantUML(d Diagram) string {
	out := "@startuml\n"

	// Build a table-ID → alias map using sanitised names.
	tblByID := make(map[string]string)
	for i, t := range d.Tables {
		tblByID[t.ID] = fmt.Sprintf("e%d", i)
	}

	// Emit entities.
	for _, t := range d.Tables {
		alias := tblByID[t.ID]
		out += fmt.Sprintf("entity \"%s\" as %s {\n", t.Name, alias)

		// Separate PK fields from non-PK fields.
		var pkFields, otherFields []Field
		for _, f := range t.Fields {
			if f.PrimaryKey {
				pkFields = append(pkFields, f)
			} else {
				otherFields = append(otherFields, f)
			}
		}

		// PK section (above the separator).
		for _, f := range pkFields {
			out += fmt.Sprintf("  * %s : %s\n", f.Name, f.Type)
		}
		if len(pkFields) > 0 {
			out += "  --\n"
		}
		// Non-PK section (below the separator).
		for _, f := range otherFields {
			prefix := " "
			if !f.Nullable {
				prefix = "*"
			}
			out += fmt.Sprintf("  %s %s : %s\n", prefix, f.Name, f.Type)
		}

		out += "}\n\n"
	}

	// Emit relationships.
	for _, r := range d.Relationships {
		src := tblByID[r.SourceTableID]
		tgt := tblByID[r.TargetTableID]
		if src == "" {
			src = r.SourceTableID
		}
		if tgt == "" {
			tgt = r.TargetTableID
		}
		arrow := plantUMLCardinality(r.Cardinality)
		label := ""
		if r.Label != "" {
			label = " : " + r.Label
		} else if r.Name != "" {
			label = " : " + r.Name
		}
		out += fmt.Sprintf("%s %s %s%s\n", src, arrow, tgt, label)
	}

	out += "@enduml\n"
	return out
}

// plantUMLCardinality maps a cardinality string to PlantUML relationship notation.
func plantUMLCardinality(c string) string {
	switch c {
	case "1-to-1":
		return "||--||"
	case "1-to-many":
		return "||--|{"
	case "1-to-0/many":
		return "||--o{"
	case "many-to-1":
		return "}|--||"
	case "many-to-many":
		return "}|--|{"
	case "0/1-to-0/1":
		return "|o--o|"
	case "0/1-to-many":
		return "|o--|{"
	case "many-to-0/many":
		return "}|--o{"
	default:
		return "||--o{"
	}
}
