package importers

import (
	"fmt"
	"regexp"
	"strings"

	"schemastudio/internal/schema"
	"schemastudio/internal/sqlx"
)

// ParseSQL parses DDL (PostgreSQL-style CREATE TABLE with optional PRIMARY KEY/FOREIGN KEY)
// and returns a TableCatalog. Table/field IDs are generated; positions are on a grid.
// ImportSource is left empty; the caller should set it to the file name.
func ParseSQL(sql string) (schema.TableCatalog, error) {
	catalog := schema.TableCatalog{Tables: nil, Relationships: nil}
	tableByName := make(map[string]int) // name -> index in catalog.Tables
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
					if refIdx, ok := tableByName[refTable]; ok && localFID != "" && refIdx >= 0 && refIdx < len(catalog.Tables) {
						refT := &catalog.Tables[refIdx]
						var refFID string
						for _, f := range refT.Fields {
							if f.Name == refCol {
								refFID = f.ID
								break
							}
						}
						if refFID != "" {
							catalog.Relationships = append(catalog.Relationships, schema.Relationship{
								ID:            idGen.rel(),
								SourceTableID: refT.ID,
								SourceFieldID: refFID,
								TargetTableID: tID,
								TargetFieldID: localFID,
							})
						}
					}
				}
				continue
			}
			// Column: name type[(args)] [NOT NULL] ...
			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}
			colName := strings.Trim(parts[0], `"`)
			// Reconstruct the raw type, which may span parts due to spaces (e.g. "double precision", "character varying(255)")
			rawType := extractRawType(line[len(parts[0]):])
			genericType, length, precision, scale := sqlx.NormalizeType(rawType)
			// Detect PK and nullable from the rest of the line
			upperLine := strings.ToUpper(line)
			isPK := strings.Contains(upperLine, "PRIMARY KEY")
			isNullable := !strings.Contains(upperLine, "NOT NULL") && !isPK
			f := schema.Field{
				ID:         idGen.field(),
				Name:       colName,
				Type:       genericType,
				Nullable:   isNullable,
				PrimaryKey: isPK,
				Length:     length,
				Precision:  precision,
				Scale:      scale,
			}
			// Store original raw type as a postgres override (DDL import is Postgres-style)
			if rawTypeLower := strings.ToLower(strings.TrimSpace(rawType)); rawTypeLower != genericType {
				f.TypeOverrides = map[string]schema.FieldTypeOverride{
					"postgres": {Type: rawTypeLower},
				}
			}
			t.Fields = append(t.Fields, f)
			fieldByName[colName] = f.ID
		}
		catalog.Tables = append(catalog.Tables, t)
		tableByName[tblName] = len(catalog.Tables) - 1
		tableOrder = append(tableOrder, tblName)
	}

	// Grid layout
	cols := 3
	for i, name := range tableOrder {
		idx, ok := tableByName[name]
		if !ok || idx < 0 || idx >= len(catalog.Tables) {
			continue
		}
		row, col := i/cols, i%cols
		catalog.Tables[idx].X = float64(col * 320)
		catalog.Tables[idx].Y = float64(row * 240)
	}
	return catalog, nil
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

// extractRawType extracts the SQL type from the remainder of a column definition line
// (after the column name has been removed). It handles multi-word types like "double precision"
// and parenthetical arguments like "varchar(255)" or "numeric(10,2)".
func extractRawType(rest string) string {
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return ""
	}

	// Known SQL keywords that signal end of type
	stopWords := map[string]bool{
		"NOT": true, "NULL": true, "DEFAULT": true, "PRIMARY": true,
		"KEY": true, "REFERENCES": true, "UNIQUE": true, "CHECK": true,
		"CONSTRAINT": true, "AUTO_INCREMENT": true, "GENERATED": true,
		"COLLATE": true, "COMMENT": true, "ON": true,
	}

	var result strings.Builder
	i := 0
	for i < len(rest) {
		ch := rest[i]
		if ch == '(' {
			// Consume parenthetical block
			depth := 1
			result.WriteByte(ch)
			i++
			for i < len(rest) && depth > 0 {
				if rest[i] == '(' {
					depth++
				} else if rest[i] == ')' {
					depth--
				}
				result.WriteByte(rest[i])
				i++
			}
		} else if ch == ' ' || ch == '\t' {
			// Peek at next word; if it's a stop-word, we're done
			remaining := strings.TrimSpace(rest[i:])
			nextWord := strings.Fields(remaining)
			if len(nextWord) == 0 {
				break
			}
			upper := strings.ToUpper(nextWord[0])
			if stopWords[upper] {
				break
			}
			// Could be multi-word type like "double precision", "character varying"
			result.WriteByte(' ')
			i++
			// skip extra whitespace
			for i < len(rest) && (rest[i] == ' ' || rest[i] == '\t') {
				i++
			}
		} else {
			result.WriteByte(ch)
			i++
		}
	}
	return strings.TrimSpace(result.String())
}

type idGen struct {
	t, f, r int
}

func newIDGen() *idGen { return &idGen{} }

func (g *idGen) table() string { g.t++; return fmt.Sprintf("t%d", g.t) }
func (g *idGen) field() string { g.f++; return fmt.Sprintf("f%d", g.f) }
func (g *idGen) rel() string   { g.r++; return fmt.Sprintf("r%d", g.r) }
