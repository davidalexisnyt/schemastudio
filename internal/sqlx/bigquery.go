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
	if !strings.Contains(s, " ") {
		return s
	}
	return "`" + strings.ReplaceAll(s, "`", "\\`") + "`"
}

// bqType maps source column types to BigQuery types per
// https://docs.cloud.google.com/datastream/docs/bq-map-data-types
// Source types with length (e.g. varchar(255)) are normalized to the base type;
// BigQuery string has no length specifier.
func bqType(t string) string {
	t = strings.ToUpper(strings.TrimSpace(t))
	base := baseType(t)
	switch base {
	// Integer family -> INT64 (Postgres, MySQL, SQL Server: smallint, int, bigint, etc.)
	case "INT", "INTEGER", "INT2", "INT4", "INT8", "SMALLINT", "BIGINT", "TINYINT", "MEDIUMINT",
		"SERIAL", "SMALLSERIAL", "BIGSERIAL", "OID", "YEAR":
		return "int64"
	// Float / double -> FLOAT64
	case "FLOAT", "REAL", "DOUBLE", "DOUBLE PRECISION", "DOUBLE_PRECISION",
		"BINARY FLOAT", "BINARY DOUBLE", "MONEY":
		return "float64"
	// Fixed precision -> NUMERIC
	case "NUMERIC", "DECIMAL":
		return "numeric"
	case "BIGNUMERIC":
		return "bignumeric"
	case "BOOL", "BOOLEAN":
		return "bool"
	// String types: no length in BigQuery (varchar(255) -> string)
	case "VARCHAR", "CHAR", "CHARACTER", "TEXT", "STRING", "LONGTEXT", "MEDIUMTEXT", "TINYTEXT",
		"NVARCHAR", "NVARCHAR2", "VARCHAR2", "CLOB", "NCLOB", "NCHAR", "ENUM", "SET",
		"CHARACTER VARYING", "CHARACTER_VARYING", "CIDR", "INET", "MACADDR", "TSQUERY", "TSVECTOR",
		"XML", "UUID", "UNIQUEIDENTIFIER", "ROWID", "RAW":
		return "string"
	case "DATE":
		return "date"
	case "TIME", "TIME WITH TIME ZONE", "TIME_WITH_TIME_ZONE":
		return "time"
	case "TIMESTAMP", "DATETIME", "DATETIME2", "SMALLDATETIME", "TIMESTAMP WITH TIME ZONE",
		"TIMESTAMP_WITH_TIME_ZONE", "DATETIMEOFFSET":
		return "timestamp"
	case "INTERVAL":
		return "interval"
	case "JSON", "JSONB":
		return "json"
	case "BYTEA", "BINARY", "VARBINARY", "BLOB", "BIT", "BIT VARYING", "BIT_VARYING":
		return "bytes"
	default:
		if base != "" {
			return strings.ToLower(base)
		}
		return "string"
	}
}

// baseType returns the type name without length/precision (e.g. "varchar(255)" -> "VARCHAR").
func baseType(t string) string {
	t = strings.ToUpper(strings.TrimSpace(t))
	if i := strings.Index(t, "("); i >= 0 {
		return strings.TrimSpace(t[:i])
	}
	return t
}
