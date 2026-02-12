package sqlx

import (
	"fmt"
	"strconv"
	"strings"

	"schemastudio/internal/schema"
)

// NormalizeType converts a raw database type string (e.g. "varchar(255)",
// "numeric(10,2)", "character varying") into a generic model type and
// optional length / precision / scale dimensions.
func NormalizeType(rawType string) (genericType string, length, precision, scale *int) {
	raw := strings.TrimSpace(rawType)
	if raw == "" {
		return "string", nil, nil, nil
	}

	upper := strings.ToUpper(raw)

	// Extract parenthesised dimensions: "varchar(255)" -> base="VARCHAR", args="255"
	base := upper
	var args string
	if i := strings.Index(upper, "("); i >= 0 {
		base = strings.TrimSpace(upper[:i])
		if j := strings.LastIndex(upper, ")"); j > i {
			args = strings.TrimSpace(upper[i+1 : j])
		}
	}

	// Normalise multi-word type names
	base = strings.ReplaceAll(base, "  ", " ")

	switch base {
	// --- String family ---
	case "VARCHAR", "CHAR", "CHARACTER", "TEXT", "STRING", "NVARCHAR", "NCHAR",
		"CHARACTER VARYING", "NVARCHAR2", "VARCHAR2", "CLOB", "NCLOB",
		"LONGTEXT", "MEDIUMTEXT", "TINYTEXT", "ENUM", "SET",
		"CIDR", "INET", "MACADDR", "TSQUERY", "TSVECTOR", "XML",
		"ROWID", "RAW":
		l := parseFirstInt(args)
		return "string", l, nil, nil

	// --- Integer family ---
	case "INT", "INTEGER", "INT2", "INT4", "INT8", "SMALLINT", "BIGINT",
		"TINYINT", "MEDIUMINT", "SERIAL", "SMALLSERIAL", "BIGSERIAL",
		"OID", "YEAR", "INT64":
		return "integer", nil, nil, nil

	// --- Float family ---
	case "FLOAT", "REAL", "DOUBLE", "DOUBLE PRECISION", "FLOAT4", "FLOAT8",
		"FLOAT64", "BINARY FLOAT", "BINARY DOUBLE", "MONEY", "SMALLMONEY":
		return "float", nil, nil, nil

	// --- Numeric / decimal ---
	case "NUMERIC", "DECIMAL", "NUMBER", "BIGNUMERIC":
		p, s := parsePrecisionScale(args)
		return "numeric", nil, p, s

	// --- Boolean ---
	case "BOOL", "BOOLEAN", "BIT":
		return "boolean", nil, nil, nil

	// --- Date ---
	case "DATE":
		return "date", nil, nil, nil

	// --- Time ---
	case "TIME", "TIME WITH TIME ZONE", "TIME WITHOUT TIME ZONE":
		return "time", nil, nil, nil

	// --- Timestamp ---
	case "TIMESTAMP", "DATETIME", "DATETIME2", "SMALLDATETIME",
		"TIMESTAMP WITH TIME ZONE", "TIMESTAMP WITHOUT TIME ZONE",
		"TIMESTAMPTZ", "DATETIMEOFFSET":
		return "timestamp", nil, nil, nil

	// --- UUID ---
	case "UUID", "UNIQUEIDENTIFIER":
		return "uuid", nil, nil, nil

	// --- JSON ---
	case "JSON", "JSONB":
		return "json", nil, nil, nil

	// --- Binary / bytes ---
	case "BYTEA", "BINARY", "VARBINARY", "BLOB", "LONGBLOB", "MEDIUMBLOB",
		"TINYBLOB", "IMAGE", "BIT VARYING", "BYTES":
		return "bytes", nil, nil, nil

	// --- Interval (map to string) ---
	case "INTERVAL":
		return "string", nil, nil, nil

	default:
		// Fall back: if it looks like it could be a known family with qualifiers, try again
		if strings.Contains(base, "INT") {
			return "integer", nil, nil, nil
		}
		if strings.Contains(base, "CHAR") || strings.Contains(base, "TEXT") || strings.Contains(base, "STRING") {
			l := parseFirstInt(args)
			return "string", l, nil, nil
		}
		if strings.Contains(base, "FLOAT") || strings.Contains(base, "DOUBLE") || strings.Contains(base, "REAL") {
			return "float", nil, nil, nil
		}
		return "other", nil, nil, nil
	}
}

// DefaultExportType returns the dialect-specific SQL type for a field.
// It first checks typeOverrides for the dialect; if present, uses it directly.
// Otherwise, it maps the generic type to the dialect default, applying
// length / precision / scale where appropriate.
func DefaultExportType(dialect, genericType string, length, precision, scale *int, overrides map[string]schema.FieldTypeOverride) string {
	// Check overrides first
	if ov, ok := overrides[dialect]; ok && ov.Type != "" {
		return ov.Type
	}

	gt := strings.ToLower(strings.TrimSpace(genericType))

	switch dialect {
	case "postgres":
		return pgDefaultType(gt, length, precision, scale)
	case "mysql":
		return mysqlDefaultType(gt, length, precision, scale)
	case "mssql":
		return mssqlDefaultType(gt, length, precision, scale)
	case "bigquery":
		return bqDefaultType(gt)
	default:
		return pgDefaultType(gt, length, precision, scale)
	}
}

// --- PostgreSQL defaults ---

func pgDefaultType(gt string, length, precision, scale *int) string {
	switch gt {
	case "string":
		if length != nil && *length > 0 {
			return fmt.Sprintf("varchar(%d)", *length)
		}
		return "varchar"
	case "integer":
		return "integer"
	case "float":
		return "double precision"
	case "numeric":
		return numericWithPS("numeric", precision, scale)
	case "boolean":
		return "boolean"
	case "date":
		return "date"
	case "time":
		return "time"
	case "timestamp":
		return "timestamp"
	case "timestamptz":
		return "timestamp with time zone"
	case "uuid":
		return "uuid"
	case "json":
		return "jsonb"
	case "bytes":
		return "bytea"
	default:
		return gt
	}
}

// --- MySQL defaults ---

func mysqlDefaultType(gt string, length, precision, scale *int) string {
	switch gt {
	case "string":
		if length != nil && *length > 0 {
			return fmt.Sprintf("varchar(%d)", *length)
		}
		return "varchar"
	case "integer":
		return "int"
	case "float":
		return "double"
	case "numeric":
		return numericWithPS("decimal", precision, scale)
	case "boolean":
		return "tinyint(1)"
	case "date":
		return "date"
	case "time":
		return "time"
	case "timestamp":
		return "datetime"
	case "uuid":
		return "char(36)"
	case "json":
		return "json"
	case "bytes":
		return "blob"
	default:
		return gt
	}
}

// --- SQL Server defaults ---

func mssqlDefaultType(gt string, length, precision, scale *int) string {
	switch gt {
	case "string":
		if length != nil && *length > 0 {
			return fmt.Sprintf("nvarchar(%d)", *length)
		}
		return "nvarchar(max)"
	case "integer":
		return "int"
	case "float":
		return "float"
	case "numeric":
		return numericWithPS("decimal", precision, scale)
	case "boolean":
		return "bit"
	case "date":
		return "date"
	case "time":
		return "time"
	case "timestamp":
		return "datetime2"
	case "uuid":
		return "uniqueidentifier"
	case "json":
		return "nvarchar(max)"
	case "bytes":
		return "varbinary(max)"
	default:
		return gt
	}
}

// --- BigQuery defaults ---

func bqDefaultType(gt string) string {
	switch gt {
	case "string":
		return "STRING"
	case "integer":
		return "INT64"
	case "float":
		return "FLOAT64"
	case "numeric":
		return "NUMERIC"
	case "boolean":
		return "BOOL"
	case "date":
		return "DATE"
	case "time":
		return "TIME"
	case "timestamp":
		return "TIMESTAMP"
	case "uuid":
		return "STRING"
	case "json":
		return "JSON"
	case "bytes":
		return "BYTES"
	default:
		return strings.ToUpper(gt)
	}
}

// --- Helpers ---

func numericWithPS(typeName string, precision, scale *int) string {
	if precision != nil && *precision > 0 {
		if scale != nil && *scale > 0 {
			return fmt.Sprintf("%s(%d,%d)", typeName, *precision, *scale)
		}
		return fmt.Sprintf("%s(%d)", typeName, *precision)
	}
	return typeName
}

func parseFirstInt(s string) *int {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	// Take the first comma-separated part
	parts := strings.Split(s, ",")
	v, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || v <= 0 {
		return nil
	}
	return &v
}

func parsePrecisionScale(s string) (precision, scale *int) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	parts := strings.Split(s, ",")
	if len(parts) >= 1 {
		v, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err == nil && v > 0 {
			precision = &v
		}
	}
	if len(parts) >= 2 {
		v, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err == nil && v >= 0 {
			scale = &v
		}
	}
	return
}
