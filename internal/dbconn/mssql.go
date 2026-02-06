package dbconn

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/microsoft/go-mssqldb"

	"schemastudio/internal/schema"
)

// MSSQLInspector implements SchemaInspector for SQL Server.
type MSSQLInspector struct {
	db *sql.DB
}

func (m *MSSQLInspector) Connect(cfg ConnectionConfig) error {
	port := cfg.Port
	if port == 0 {
		port = 1433
	}
	encrypt := "true"
	if cfg.SSLMode == "disable" || cfg.SSLMode == "none" {
		encrypt = "disable"
	}
	dsn := fmt.Sprintf("sqlserver://%s:%s@%s:%d?database=%s&encrypt=%s&TrustServerCertificate=true",
		cfg.Username, cfg.Password, cfg.Host, port, cfg.Database, encrypt)

	db, err := sql.Open("sqlserver", dsn)
	if err != nil {
		return fmt.Errorf("mssql connect: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return fmt.Errorf("mssql ping: %w", err)
	}
	m.db = db
	return nil
}

func (m *MSSQLInspector) Close() error {
	if m.db != nil {
		return m.db.Close()
	}
	return nil
}

var mssqlSystemSchemas = []string{
	"information_schema", "sys", "guest", "db_owner",
	"db_accessadmin", "db_securityadmin", "db_ddladmin",
	"db_backupoperator", "db_datareader", "db_datawriter",
	"db_denydatareader", "db_denydatawriter",
}

func (m *MSSQLInspector) ListSchemas() ([]string, error) {
	return listSchemasSQL(m.db, mssqlSystemSchemas)
}

func (m *MSSQLInspector) ListTables(schemaName string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	rows, err := m.db.QueryContext(ctx,
		"SELECT table_name FROM information_schema.tables WHERE table_schema = @p1 AND table_type = 'BASE TABLE' ORDER BY table_name",
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

// mssqlPlaceholder returns @p1, @p2, ... style placeholders for SQL Server.
func mssqlPlaceholder(n int) string {
	return fmt.Sprintf("@p%d", n)
}

func (m *MSSQLInspector) InspectSchema(schemaName string, tableNames []string) (schema.TableCatalog, error) {
	columns, err := queryColumnsGeneric(m.db, schemaName, tableNames, mssqlPlaceholder)
	if err != nil {
		return schema.TableCatalog{}, err
	}
	pks, err := queryPKsGeneric(m.db, schemaName, tableNames, mssqlPlaceholder)
	if err != nil {
		return schema.TableCatalog{}, err
	}
	fks, err := m.queryForeignKeys(schemaName, tableNames)
	if err != nil {
		return schema.TableCatalog{}, err
	}
	return buildCatalog(columns, pks, fks, fmt.Sprintf("%s (SQL Server)", schemaName)), nil
}

// queryForeignKeys retrieves FK relationships for SQL Server using referential_constraints + key_column_usage.
func (m *MSSQLInspector) queryForeignKeys(schemaName string, tableNames []string) ([]fkInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	query := `SELECT
		fk_kcu.TABLE_NAME AS source_table,
		fk_kcu.COLUMN_NAME AS source_column,
		pk_kcu.TABLE_NAME AS target_table,
		pk_kcu.COLUMN_NAME AS target_column
	FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
	JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE fk_kcu
		ON rc.CONSTRAINT_NAME = fk_kcu.CONSTRAINT_NAME
		AND rc.CONSTRAINT_SCHEMA = fk_kcu.CONSTRAINT_SCHEMA
	JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE pk_kcu
		ON rc.UNIQUE_CONSTRAINT_NAME = pk_kcu.CONSTRAINT_NAME
		AND rc.UNIQUE_CONSTRAINT_SCHEMA = pk_kcu.CONSTRAINT_SCHEMA
		AND fk_kcu.ORDINAL_POSITION = pk_kcu.ORDINAL_POSITION
	WHERE rc.CONSTRAINT_SCHEMA = @p1`

	args := []interface{}{schemaName}
	if len(tableNames) > 0 {
		placeholders := make([]string, len(tableNames))
		for i := range tableNames {
			placeholders[i] = fmt.Sprintf("@p%d", i+2)
			args = append(args, tableNames[i])
		}
		query += fmt.Sprintf(" AND fk_kcu.TABLE_NAME IN (%s)", strings.Join(placeholders, ","))
	}

	rows, err := m.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying mssql foreign keys: %w", err)
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
