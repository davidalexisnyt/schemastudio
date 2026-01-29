package schema

import "encoding/json"

// Diagram is the root document for save/load and import/export.
type Diagram struct {
	Version       int            `json:"version"`
	Tables        []Table        `json:"tables"`
	Relationships []Relationship `json:"relationships"`
	Viewport      *Viewport      `json:"viewport,omitempty"`
}

// Table represents a table on the canvas.
type Table struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Fields []Field `json:"fields"`
}

// Field is a column in a table.
type Field struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// Relationship links a source field to a target field.
type Relationship struct {
	ID             string `json:"id"`
	SourceTableID  string `json:"sourceTableId"`
	SourceFieldID  string `json:"sourceFieldId"`
	TargetTableID  string `json:"targetTableId"`
	TargetFieldID  string `json:"targetFieldId"`
	Label          string `json:"label,omitempty"`
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
