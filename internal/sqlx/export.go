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

// Dialects returns the list of registered dialect names.
func Dialects() []string {
	names := make([]string, 0, len(registry))
	for k := range registry {
		names = append(names, k)
	}
	return names
}
