package dbconn

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"

	"schemastudio/internal/schema"
)

// PostgresInspector implements SchemaInspector for PostgreSQL.
type PostgresInspector struct {
	db *sql.DB
}

func (p *PostgresInspector) Connect(cfg ConnectionConfig) error {
	sslMode := cfg.SSLMode
	if sslMode == "" {
		sslMode = "prefer"
	}
	port := cfg.Port
	if port == 0 {
		port = 5432
	}
	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host, port, cfg.Username, cfg.Password, cfg.Database, sslMode)

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("postgres connect: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return fmt.Errorf("postgres ping: %w", err)
	}
	p.db = db
	return nil
}

func (p *PostgresInspector) Close() error {
	if p.db != nil {
		return p.db.Close()
	}
	return nil
}

// pgSystemSchemas are schemas excluded from listing.
var pgSystemSchemas = []string{
	"information_schema", "pg_catalog", "pg_toast",
	"pg_temp_1", "pg_toast_temp_1",
}

func (p *PostgresInspector) ListSchemas() ([]string, error) {
	return listSchemasSQL(p.db, pgSystemSchemas)
}

func (p *PostgresInspector) ListTables(schemaName string) ([]string, error) {
	return listTablesSQL(p.db, schemaName)
}

// pgPlaceholder returns $1, $2, ... style placeholders for PostgreSQL.
func pgPlaceholder(n int) string {
	return fmt.Sprintf("$%d", n)
}

func (p *PostgresInspector) InspectSchema(schemaName string, tableNames []string) (schema.TableCatalog, error) {
	columns, err := queryColumnsGeneric(p.db, schemaName, tableNames, pgPlaceholder)
	if err != nil {
		return schema.TableCatalog{}, err
	}
	pks, err := queryPKsGeneric(p.db, schemaName, tableNames, pgPlaceholder)
	if err != nil {
		return schema.TableCatalog{}, err
	}
	fks, err := p.queryForeignKeys(schemaName, tableNames)
	if err != nil {
		return schema.TableCatalog{}, err
	}
	return buildCatalog(columns, pks, fks, fmt.Sprintf("%s (PostgreSQL)", schemaName), "postgres"), nil
}

// queryForeignKeys retrieves FK relationships for PostgreSQL using constraint_column_usage.
func (p *PostgresInspector) queryForeignKeys(schemaName string, tableNames []string) ([]fkInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	query := `SELECT
		kcu.table_name AS source_table,
		kcu.column_name AS source_column,
		ccu.table_name AS target_table,
		ccu.column_name AS target_column
	FROM information_schema.table_constraints tc
	JOIN information_schema.key_column_usage kcu
		ON tc.constraint_name = kcu.constraint_name
		AND tc.table_schema = kcu.table_schema
	JOIN information_schema.constraint_column_usage ccu
		ON tc.constraint_name = ccu.constraint_name
		AND tc.table_schema = ccu.table_schema
	WHERE tc.table_schema = $1
		AND tc.constraint_type = 'FOREIGN KEY'`

	args := []interface{}{schemaName}
	if len(tableNames) > 0 {
		placeholders := make([]string, len(tableNames))
		for i := range tableNames {
			placeholders[i] = fmt.Sprintf("$%d", i+2)
			args = append(args, tableNames[i])
		}
		query += fmt.Sprintf(" AND kcu.table_name IN (%s)", strings.Join(placeholders, ","))
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying postgres foreign keys: %w", err)
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
