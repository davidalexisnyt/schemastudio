package sqlx

import (
	"bytes"
	"strings"

	"erd/internal/schema"
)

// PostgresExporter generates PostgreSQL DDL with PRIMARY KEY and FOREIGN KEY.
type PostgresExporter struct{}

func (p *PostgresExporter) Dialect() string { return "postgres" }

func (p *PostgresExporter) Export(d schema.Diagram) (string, error) {
	var b bytes.Buffer
	tableByID := make(map[string]*schema.Table)
	for i := range d.Tables {
		tableByID[d.Tables[i].ID] = &d.Tables[i]
	}
	for _, t := range d.Tables {
		b.WriteString("CREATE TABLE ")
		b.WriteString(quoteIdent(t.Name))
		b.WriteString(" (\n")
		var pk []string
		for i, f := range t.Fields {
			if i > 0 {
				b.WriteString(",\n")
			}
			b.WriteString("  ")
			b.WriteString(quoteIdent(f.Name))
			b.WriteString(" ")
			b.WriteString(pgType(f.Type))
			b.WriteString(" NOT NULL")
			if strings.EqualFold(f.Name, "id") {
				pk = append(pk, f.Name)
			}
		}
		if len(pk) > 0 {
			b.WriteString(",\n  PRIMARY KEY (")
			b.WriteString(quoteIdent(pk[0]))
			b.WriteString(")")
		}
		for _, r := range d.Relationships {
			if r.TargetTableID != t.ID {
				continue
			}
			srcT := tableByID[r.SourceTableID]
			if srcT == nil {
				continue
			}
			var srcF, tgtF string
			for _, f := range srcT.Fields {
				if f.ID == r.SourceFieldID {
					srcF = f.Name
					break
				}
			}
			for _, f := range t.Fields {
				if f.ID == r.TargetFieldID {
					tgtF = f.Name
					break
				}
			}
			if srcF != "" && tgtF != "" {
				b.WriteString(",\n  FOREIGN KEY (")
				b.WriteString(quoteIdent(tgtF))
				b.WriteString(") REFERENCES ")
				b.WriteString(quoteIdent(srcT.Name))
				b.WriteString(" (")
				b.WriteString(quoteIdent(srcF))
				b.WriteString(")")
			}
		}
		b.WriteString("\n);\n\n")
	}
	return b.String(), nil
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func pgType(t string) string {
	t = strings.ToUpper(strings.TrimSpace(t))
	switch t {
	case "INT", "INTEGER", "INT4":
		return "INTEGER"
	case "BIGINT", "INT8":
		return "BIGINT"
	case "SMALLINT", "INT2":
		return "SMALLINT"
	case "VARCHAR", "STRING", "TEXT":
		return "TEXT"
	case "NUMERIC", "DECIMAL":
		return "NUMERIC"
	case "FLOAT", "REAL":
		return "REAL"
	case "DOUBLE":
		return "DOUBLE PRECISION"
	case "BOOL", "BOOLEAN":
		return "BOOLEAN"
	case "DATE":
		return "DATE"
	case "TIMESTAMP", "DATETIME":
		return "TIMESTAMP"
	case "UUID":
		return "UUID"
	default:
		if t != "" {
			return t
		}
		return "TEXT"
	}
}
