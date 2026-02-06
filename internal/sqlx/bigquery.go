package sqlx

import (
	"bytes"
	"strings"

	"schemastudio/internal/schema"
)

// BigQueryExporter generates BigQuery DDL (no PK/FK; columns only).
type BigQueryExporter struct{}

func (b *BigQueryExporter) Dialect() string { return "bigquery" }

func (b *BigQueryExporter) Export(d schema.Diagram) (string, error) {
	return ExportBigQueryWithTarget(d, "", "", "")
}

// ExportBigQueryWithTarget generates BigQuery DDL with optional fully qualified table names.
// If project and dataset are both non-empty, table names are output as `project.dataset.tablename`.
// creationMode: "if_not_exists" -> CREATE TABLE IF NOT EXISTS; "create_or_replace" -> CREATE OR REPLACE TABLE; else -> CREATE TABLE.
func ExportBigQueryWithTarget(d schema.Diagram, project, dataset, creationMode string) (string, error) {
	var buf bytes.Buffer
	qualify := project != "" && dataset != ""
	createClause := "create table "
	switch creationMode {
	case "if_not_exists":
		createClause = "create table if not exists "
	case "create_or_replace":
		createClause = "create or replace table "
	}
	for _, t := range d.Tables {
		buf.WriteString(createClause)
		if qualify {
			buf.WriteString(quoteIdentBQ(project))
			buf.WriteString(".")
			buf.WriteString(quoteIdentBQ(dataset))
			buf.WriteString(".")
		}
		buf.WriteString(quoteIdentBQ(t.Name))
		buf.WriteString(" (\n")
		for i, f := range t.Fields {
			if i > 0 {
				buf.WriteString(",\n")
			}
			buf.WriteString("  ")
			buf.WriteString(quoteIdentBQ(f.Name))
			buf.WriteString(" ")
			buf.WriteString(DefaultExportType("bigquery", f.Type, f.Length, f.Precision, f.Scale, f.TypeOverrides))
			if !f.Nullable {
				buf.WriteString(" not null")
			}
		}
		buf.WriteString("\n);\n\n")
	}
	return buf.String(), nil
}

func quoteIdentBQ(s string) string {
	if s == "" {
		return "``"
	}
	if !strings.Contains(s, " ") {
		return s
	}
	return "`" + strings.ReplaceAll(s, "`", "\\`") + "`"
}

