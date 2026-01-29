package sqlx

import (
	"bytes"
	"strings"

	"erd/internal/schema"
)

// BigQueryExporter generates BigQuery DDL (no PK/FK; columns only).
type BigQueryExporter struct{}

func (b *BigQueryExporter) Dialect() string { return "bigquery" }

func (b *BigQueryExporter) Export(d schema.Diagram) (string, error) {
	var buf bytes.Buffer
	for _, t := range d.Tables {
		buf.WriteString("CREATE TABLE ")
		buf.WriteString(quoteIdentBQ(t.Name))
		buf.WriteString(" (\n")
		for i, f := range t.Fields {
			if i > 0 {
				buf.WriteString(",\n")
			}
			buf.WriteString("  ")
			buf.WriteString(quoteIdentBQ(f.Name))
			buf.WriteString(" ")
			buf.WriteString(bqType(f.Type))
		}
		buf.WriteString("\n);\n\n")
	}
	return buf.String(), nil
}

func quoteIdentBQ(s string) string {
	if s == "" {
		return "``"
	}
	return "`" + strings.ReplaceAll(s, "`", "\\`") + "`"
}

func bqType(t string) string {
	t = strings.ToUpper(strings.TrimSpace(t))
	switch t {
	case "INT", "INTEGER", "INT4", "INT8", "BIGINT", "SMALLINT":
		return "INT64"
	case "FLOAT", "REAL":
		return "FLOAT64"
	case "NUMERIC", "DECIMAL":
		return "NUMERIC"
	case "BOOL", "BOOLEAN":
		return "BOOL"
	case "VARCHAR", "STRING", "TEXT":
		return "STRING"
	case "DATE":
		return "DATE"
	case "TIMESTAMP", "DATETIME":
		return "TIMESTAMP"
	case "UUID":
		return "STRING"
	default:
		if t != "" {
			return t
		}
		return "STRING"
	}
}
