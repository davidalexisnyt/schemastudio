package importers

import (
	"regexp"
	"strings"

	"erd/internal/schema"
)

// ParseMermaid parses Mermaid erDiagram syntax and returns a Diagram.
// Positions are assigned on a grid.
func ParseMermaid(mermaid string) (schema.Diagram, error) {
	d := schema.NewDiagram()
	lines := strings.Split(mermaid, "\n")
	tableByName := make(map[string]int) // name -> index in d.Tables
	idGen := newIDGen()

	// Find entity blocks: "    name {" then "        type name PK/FK" until "    }"
	entityBlock := regexp.MustCompile(`^\s*(\w[\w\d_]*)\s*\{\s*$`)
	fieldLine := regexp.MustCompile(`^\s*(\w+)\s+(\w[\w\d_]*)\s*(PK|FK)?\s*$`)
	closeBlock := regexp.MustCompile(`^\s*\}\s*$`)

	currentTableIndex := -1
	for _, line := range lines {
		line = strings.TrimRight(line, " \t")
		if m := entityBlock.FindStringSubmatch(line); len(m) > 0 {
			name := m[1]
			if strings.EqualFold(name, "erDiagram") {
				continue
			}
			tID := idGen.table()
			t := schema.Table{
				ID:     tID,
				Name:   name,
				X:      0,
				Y:      0,
				Fields: []schema.Field{},
			}
			d.Tables = append(d.Tables, t)
			currentTableIndex = len(d.Tables) - 1
			tableByName[name] = currentTableIndex
			continue
		}
		if currentTableIndex >= 0 && closeBlock.MatchString(line) {
			currentTableIndex = -1
			continue
		}
		if currentTableIndex >= 0 {
			if m := fieldLine.FindStringSubmatch(line); len(m) >= 3 {
				typ, name := m[1], m[2]
				fID := idGen.field()
				d.Tables[currentTableIndex].Fields = append(d.Tables[currentTableIndex].Fields, schema.Field{
					ID:   fID,
					Name: name,
					Type: typ,
				})
			}
		}
	}

	// Relationship lines: "    A ||--o{ B : label" or "    A ||--o{ B"
	relLine := regexp.MustCompile(`^\s*(\w[\w\d_]*)\s*\|[\|\-]+\w*\{\s*(\w[\w\d_]*)\s*(?::\s*(.*))?$`)
	for _, line := range lines {
		m := relLine.FindStringSubmatch(line)
		if len(m) < 3 {
			continue
		}
		srcName, tgtName := m[1], m[2]
		srcIdx, srcOk := tableByName[srcName]
		tgtIdx, tgtOk := tableByName[tgtName]
		if !srcOk || !tgtOk || srcIdx < 0 || srcIdx >= len(d.Tables) || tgtIdx < 0 || tgtIdx >= len(d.Tables) {
			continue
		}
		srcT := &d.Tables[srcIdx]
		tgtT := &d.Tables[tgtIdx]
		var srcFID, tgtFID string
		if len(srcT.Fields) > 0 {
			srcFID = srcT.Fields[0].ID
		}
		if len(tgtT.Fields) > 0 {
			tgtFID = tgtT.Fields[0].ID
		}
		if srcFID == "" || tgtFID == "" {
			continue
		}
		label := ""
		if len(m) > 3 {
			label = strings.TrimSpace(m[3])
		}
		d.Relationships = append(d.Relationships, schema.Relationship{
			ID:             idGen.rel(),
			SourceTableID:  srcT.ID,
			SourceFieldID:  srcFID,
			TargetTableID:  tgtT.ID,
			TargetFieldID: tgtFID,
			Label:         label,
		})
	}

	// Grid layout
	cols := 3
	for i := range d.Tables {
		row, col := i/cols, i%cols
		d.Tables[i].X = float64(col * 320)
		d.Tables[i].Y = float64(row * 240)
	}
	return d, nil
}
