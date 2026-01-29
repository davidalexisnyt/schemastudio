package importers

import (
	"fmt"
	"regexp"
	"strings"

	"erd/internal/schema"
)

// ParseSQL parses DDL (PostgreSQL-style CREATE TABLE with optional PRIMARY KEY/FOREIGN KEY)
// and returns a Diagram. Table/field IDs are generated UUIDs; positions are on a grid.
func ParseSQL(sql string) (schema.Diagram, error) {
	d := schema.NewDiagram()
	tableByName := make(map[string]int) // name -> index in d.Tables
	tableOrder := []string{}
	idGen := newIDGen()

	// Find each CREATE TABLE ... ( ... ); with balanced parens
	reStart := regexp.MustCompile(`(?i)CREATE\s+TABLE\s+([^\s(]+)\s*\(`)
	for {
		loc := reStart.FindStringIndex(sql)
		if loc == nil {
			break
		}
		start := loc[1]
		tblName := strings.TrimSpace(strings.Trim(reStart.FindStringSubmatch(sql)[1], `"`))
		paren := 1
		i := start
		for i < len(sql) && paren > 0 {
			switch sql[i] {
			case '(':
				paren++
			case ')':
				paren--
			}
			i++
		}
		if paren != 0 {
			sql = sql[start:]
			continue
		}
		body := sql[start : i-1]
		sql = sql[i:]
		tID := idGen.table()
		t := schema.Table{
			ID:     tID,
			Name:   tblName,
			X:      0,
			Y:      0,
			Fields: []schema.Field{},
		}
		fieldByName := make(map[string]string) // name -> field ID
		lines := splitBody(body)
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			upper := strings.ToUpper(line)
			if strings.HasPrefix(upper, "PRIMARY KEY") {
				continue
			}
			if strings.HasPrefix(upper, "FOREIGN KEY") {
				// Parse FOREIGN KEY (col) REFERENCES other(ref_col)
				fkMatch := regexp.MustCompile(`(?i)FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)`).FindStringSubmatch(line)
				if len(fkMatch) >= 4 {
					localCol := strings.TrimSpace(strings.Trim(fkMatch[1], `"`))
					refTable := strings.TrimSpace(strings.Trim(fkMatch[2], `"`))
					refCol := strings.TrimSpace(strings.Trim(fkMatch[3], `"`))
					localFID := fieldByName[localCol]
					if refIdx, ok := tableByName[refTable]; ok && localFID != "" && refIdx >= 0 && refIdx < len(d.Tables) {
						refT := &d.Tables[refIdx]
						var refFID string
						for _, f := range refT.Fields {
							if f.Name == refCol {
								refFID = f.ID
								break
							}
						}
						if refFID != "" {
							d.Relationships = append(d.Relationships, schema.Relationship{
								ID:             idGen.rel(),
								SourceTableID:  refT.ID,
								SourceFieldID:  refFID,
								TargetTableID:  tID,
								TargetFieldID: localFID,
							})
						}
					}
				}
				continue
			}
			// Column: name type [NOT NULL] ...
			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}
			colName := strings.Trim(parts[0], `"`)
			colType := parts[1]
			fID := idGen.field()
			t.Fields = append(t.Fields, schema.Field{ID: fID, Name: colName, Type: colType})
			fieldByName[colName] = fID
		}
		d.Tables = append(d.Tables, t)
		tableByName[tblName] = len(d.Tables) - 1
		tableOrder = append(tableOrder, tblName)
	}

	// Grid layout
	cols := 3
	for i, name := range tableOrder {
		idx, ok := tableByName[name]
		if !ok || idx < 0 || idx >= len(d.Tables) {
			continue
		}
		row, col := i/cols, i%cols
		d.Tables[idx].X = float64(col * 320)
		d.Tables[idx].Y = float64(row * 240)
	}
	return d, nil
}

func splitBody(body string) []string {
	var lines []string
	var current strings.Builder
	paren := 0
	for _, r := range body {
		switch r {
		case '(':
			paren++
			current.WriteRune(r)
		case ')':
			paren--
			current.WriteRune(r)
		case ',':
			if paren == 0 {
				lines = append(lines, current.String())
				current.Reset()
			} else {
				current.WriteRune(r)
			}
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		lines = append(lines, current.String())
	}
	return lines
}

type idGen struct {
	t, f, r int
}

func newIDGen() *idGen { return &idGen{} }

func (g *idGen) table() string { g.t++; return fmt.Sprintf("t%d", g.t) }
func (g *idGen) field() string { g.f++; return fmt.Sprintf("f%d", g.f) }
func (g *idGen) rel() string   { g.r++; return fmt.Sprintf("r%d", g.r) }
