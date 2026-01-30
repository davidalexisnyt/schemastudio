package sqlx

import (
	"fmt"
	"strings"

	"schemastudio/internal/schema"
)

// Exporter generates DDL for a dialect.
type Exporter interface {
	Dialect() string
	Export(d schema.Diagram) (string, error)
}

var registry = map[string]Exporter{
	"postgres": &PostgresExporter{},
	"bigquery": &BigQueryExporter{},
}

// Register adds an exporter for a dialect name.
func Register(name string, e Exporter) {
	registry[name] = e
}

// Export returns DDL for the given dialect, or an error if unknown.
func Export(dialect string, d schema.Diagram) (string, error) {
	e, ok := registry[strings.ToLower(dialect)]
	if !ok {
		return "", fmt.Errorf("unknown dialect: %s", dialect)
	}
	return e.Export(d)
}

// ExportPostgres returns PostgreSQL DDL. If schema is non-empty, table names are schema-qualified.
func ExportPostgres(d schema.Diagram, schema string) (string, error) {
	return ExportPostgresWithSchema(d, schema)
}

// Dialects returns the list of registered dialect names.
func Dialects() []string {
	names := make([]string, 0, len(registry))
	for k := range registry {
		names = append(names, k)
	}
	return names
}
