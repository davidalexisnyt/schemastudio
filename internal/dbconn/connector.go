// Package dbconn provides database schema introspection for multiple backends.
// It produces schema.TableCatalog results compatible with the existing import pipeline.
package dbconn

import (
	"fmt"

	"schemastudio/internal/schema"
)

// ConnectionConfig holds the parameters needed to connect to a database backend.
type ConnectionConfig struct {
	Driver   string `json:"driver"`   // postgres, mysql, mssql, bigquery
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	SSLMode  string `json:"sslMode,omitempty"`

	// BigQuery-specific
	Project         string `json:"project,omitempty"`
	Dataset         string `json:"dataset,omitempty"`
	CredentialsFile string `json:"credentialsFile,omitempty"`
	// BigQuery auth mode: "service_account" or "user_oauth"
	BigQueryAuthMode string `json:"bigqueryAuthMode,omitempty"`
}

// SchemaInspector is the common interface for database schema introspection.
type SchemaInspector interface {
	// Connect establishes a connection to the database.
	Connect(cfg ConnectionConfig) error
	// Close closes the connection.
	Close() error
	// ListSchemas returns the list of schema names (or datasets for BigQuery).
	ListSchemas() ([]string, error)
	// ListTables returns the list of table names in the given schema.
	ListTables(schemaName string) ([]string, error)
	// InspectSchema introspects the specified tables (or all tables if tableNames is empty)
	// and returns a TableCatalog with tables, fields, and relationships.
	InspectSchema(schemaName string, tableNames []string) (schema.TableCatalog, error)
}

// NewInspector creates a SchemaInspector for the given driver name.
func NewInspector(driver string) (SchemaInspector, error) {
	switch driver {
	case "postgres":
		return &PostgresInspector{}, nil
	case "mysql":
		return &MySQLInspector{}, nil
	case "mssql":
		return &MSSQLInspector{}, nil
	case "bigquery":
		return &BigQueryInspector{}, nil
	default:
		return nil, fmt.Errorf("unsupported database driver: %s", driver)
	}
}
