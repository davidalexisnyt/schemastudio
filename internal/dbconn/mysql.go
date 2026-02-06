package dbconn

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/go-sql-driver/mysql"

	"schemastudio/internal/schema"
)

// MySQLInspector implements SchemaInspector for MySQL / MariaDB.
type MySQLInspector struct {
	db *sql.DB
}

func (m *MySQLInspector) Connect(cfg ConnectionConfig) error {
	port := cfg.Port
	if port == 0 {
		port = 3306
	}
	// DSN: user:password@tcp(host:port)/dbname?parseTime=true&tls=preferred
	tls := "preferred"
	if cfg.SSLMode == "disable" || cfg.SSLMode == "none" {
		tls = "false"
	} else if cfg.SSLMode == "require" {
		tls = "true"
	}
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&tls=%s",
		cfg.Username, cfg.Password, cfg.Host, port, cfg.Database, tls)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("mysql connect: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return fmt.Errorf("mysql ping: %w", err)
	}
	m.db = db
	return nil
}

func (m *MySQLInspector) Close() error {
	if m.db != nil {
		return m.db.Close()
	}
	return nil
}

var mysqlSystemSchemas = []string{
	"information_schema", "mysql", "performance_schema", "sys",
}

func (m *MySQLInspector) ListSchemas() ([]string, error) {
	return listSchemasSQL(m.db, mysqlSystemSchemas)
}

func (m *MySQLInspector) ListTables(schemaName string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	rows, err := m.db.QueryContext(ctx,
		"SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
		schemaName)
	if err != nil {
		return nil, fmt.Errorf("listing tables: %w", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, name)
	}
	return tables, rows.Err()
}

// mysqlPlaceholder returns ? style placeholders.
func mysqlPlaceholder(_ int) string {
	return "?"
}

func (m *MySQLInspector) InspectSchema(schemaName string, tableNames []string) (schema.TableCatalog, error) {
	columns, err := queryColumnsGeneric(m.db, schemaName, tableNames, mysqlPlaceholder)
	if err != nil {
		return schema.TableCatalog{}, err
	}
	pks, err := queryPKsGeneric(m.db, schemaName, tableNames, mysqlPlaceholder)
	if err != nil {
		return schema.TableCatalog{}, err
	}
	fks, err := m.queryForeignKeys(schemaName, tableNames)
	if err != nil {
		return schema.TableCatalog{}, err
	}
	return buildCatalog(columns, pks, fks, fmt.Sprintf("%s (MySQL)", schemaName), "mysql"), nil
}

// queryForeignKeys retrieves FK relationships for MySQL using REFERENCED_TABLE_NAME/COLUMN_NAME.
func (m *MySQLInspector) queryForeignKeys(schemaName string, tableNames []string) ([]fkInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	query := `SELECT
		kcu.TABLE_NAME AS source_table,
		kcu.COLUMN_NAME AS source_column,
		kcu.REFERENCED_TABLE_NAME AS target_table,
		kcu.REFERENCED_COLUMN_NAME AS target_column
	FROM information_schema.KEY_COLUMN_USAGE kcu
	WHERE kcu.TABLE_SCHEMA = ?
		AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`

	args := []interface{}{schemaName}
	if len(tableNames) > 0 {
		placeholders := make([]string, len(tableNames))
		for i := range tableNames {
			placeholders[i] = "?"
			args = append(args, tableNames[i])
		}
		query += fmt.Sprintf(" AND kcu.TABLE_NAME IN (%s)", strings.Join(placeholders, ","))
	}

	rows, err := m.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying mysql foreign keys: %w", err)
	}
	defer rows.Close()

	var fks []fkInfo
	for rows.Next() {
		var fk fkInfo
		if err := rows.Scan(&fk.SourceTable, &fk.SourceColumn, &fk.TargetTable, &fk.TargetColumn); err != nil {
			return nil, err
		}
		fks = append(fks, fk)
	}
	return fks, rows.Err()
}
