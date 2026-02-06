package dbconn

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	"schemastudio/internal/schema"
	"schemastudio/internal/sqlx"
)

const queryTimeout = 30 * time.Second

// idGen generates sequential IDs for tables, fields, and relationships.
type idGen struct {
	t, f, r int
}

func newIDGen() *idGen { return &idGen{} }

func (g *idGen) table() string { g.t++; return fmt.Sprintf("t%d", g.t) }
func (g *idGen) field() string { g.f++; return fmt.Sprintf("f%d", g.f) }
func (g *idGen) rel() string   { g.r++; return fmt.Sprintf("r%d", g.r) }

// columnInfo holds metadata for a single column as read from INFORMATION_SCHEMA.
type columnInfo struct {
	TableName    string
	ColumnName   string
	DataType     string
	IsNullable   bool
	OrdinalPos   int
	CharMaxLen   *int // from character_maximum_length
	NumPrecision *int // from numeric_precision
	NumScale     *int // from numeric_scale
}

// fkInfo holds a foreign key relationship as read from the database.
type fkInfo struct {
	SourceTable  string
	SourceColumn string
	TargetTable  string
	TargetColumn string
}

// pkInfo holds a primary key column reference.
type pkInfo struct {
	TableName  string
	ColumnName string
}

// listSchemasSQL queries INFORMATION_SCHEMA.SCHEMATA and returns non-system schemas.
func listSchemasSQL(db *sql.DB, excludes []string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	rows, err := db.QueryContext(ctx, "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name")
	if err != nil {
		return nil, fmt.Errorf("listing schemas: %w", err)
	}
	defer rows.Close()

	excludeSet := make(map[string]bool, len(excludes))
	for _, e := range excludes {
		excludeSet[strings.ToLower(e)] = true
	}

	var schemas []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		if !excludeSet[strings.ToLower(name)] {
			schemas = append(schemas, name)
		}
	}
	return schemas, rows.Err()
}

// listTablesSQL queries INFORMATION_SCHEMA.TABLES for base tables in the given schema.
func listTablesSQL(db *sql.DB, schemaName string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	rows, err := db.QueryContext(ctx,
		"SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
		schemaName)
	if err != nil {
		// Try with ? placeholder for MySQL/MSSQL
		rows, err = db.QueryContext(ctx,
			"SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
			schemaName)
		if err != nil {
			return nil, fmt.Errorf("listing tables: %w", err)
		}
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

// queryColumnsGeneric queries INFORMATION_SCHEMA.COLUMNS for the given schema and tables.
// Uses the supplied placeholder function to adapt to different SQL dialects.
func queryColumnsGeneric(db *sql.DB, schemaName string, tableNames []string, ph func(int) string) ([]columnInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	query := fmt.Sprintf(`SELECT table_name, column_name, data_type, is_nullable, ordinal_position,
		character_maximum_length, numeric_precision, numeric_scale
		FROM information_schema.columns
		WHERE table_schema = %s`, ph(1))

	args := []interface{}{schemaName}
	if len(tableNames) > 0 {
		placeholders := make([]string, len(tableNames))
		for i := range tableNames {
			placeholders[i] = ph(i + 2)
			args = append(args, tableNames[i])
		}
		query += fmt.Sprintf(" AND table_name IN (%s)", strings.Join(placeholders, ","))
	}
	query += " ORDER BY table_name, ordinal_position"

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying columns: %w", err)
	}
	defer rows.Close()

	var cols []columnInfo
	for rows.Next() {
		var c columnInfo
		var nullable string
		if err := rows.Scan(&c.TableName, &c.ColumnName, &c.DataType, &nullable, &c.OrdinalPos,
			&c.CharMaxLen, &c.NumPrecision, &c.NumScale); err != nil {
			return nil, err
		}
		c.IsNullable = strings.EqualFold(nullable, "YES")
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

// queryPKsGeneric queries primary key columns for the given schema and tables.
func queryPKsGeneric(db *sql.DB, schemaName string, tableNames []string, ph func(int) string) ([]pkInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	query := fmt.Sprintf(`SELECT kcu.table_name, kcu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
		  ON tc.constraint_name = kcu.constraint_name
		  AND tc.table_schema = kcu.table_schema
		WHERE tc.table_schema = %s
		  AND tc.constraint_type = 'PRIMARY KEY'`, ph(1))

	args := []interface{}{schemaName}
	if len(tableNames) > 0 {
		placeholders := make([]string, len(tableNames))
		for i := range tableNames {
			placeholders[i] = ph(i + 2)
			args = append(args, tableNames[i])
		}
		query += fmt.Sprintf(" AND tc.table_name IN (%s)", strings.Join(placeholders, ","))
	}

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying primary keys: %w", err)
	}
	defer rows.Close()

	var pks []pkInfo
	for rows.Next() {
		var pk pkInfo
		if err := rows.Scan(&pk.TableName, &pk.ColumnName); err != nil {
			return nil, err
		}
		pks = append(pks, pk)
	}
	return pks, rows.Err()
}

// buildCatalog assembles a TableCatalog from column, PK, and FK data.
// dialect identifies the source database ("postgres", "mysql", "mssql", "bigquery").
func buildCatalog(columns []columnInfo, pks []pkInfo, fks []fkInfo, importSource, dialect string) schema.TableCatalog {
	gen := newIDGen()

	// Build PK lookup: tableName.columnName -> true
	pkSet := make(map[string]bool)
	for _, pk := range pks {
		pkSet[pk.TableName+"."+pk.ColumnName] = true
	}

	// Group columns by table
	type tableData struct {
		name    string
		columns []columnInfo
	}
	tableMap := make(map[string]*tableData)
	var tableOrder []string
	for _, c := range columns {
		td, ok := tableMap[c.TableName]
		if !ok {
			td = &tableData{name: c.TableName}
			tableMap[c.TableName] = td
			tableOrder = append(tableOrder, c.TableName)
		}
		td.columns = append(td.columns, c)
	}
	sort.Strings(tableOrder)

	// Build tables and field lookups
	tables := make([]schema.Table, 0, len(tableOrder))
	// Maps for FK resolution: tableName -> tableID, tableName.colName -> fieldID
	tableIDMap := make(map[string]string)
	fieldIDMap := make(map[string]string)

	cols := 3
	for i, tblName := range tableOrder {
		td := tableMap[tblName]
		tID := gen.table()
		tableIDMap[tblName] = tID

		var fields []schema.Field
		for _, c := range td.columns {
			fID := gen.field()
			fieldIDMap[tblName+"."+c.ColumnName] = fID

			// Normalize the raw data_type into our generic model type
			genericType, normLen, normPrec, normScale := sqlx.NormalizeType(c.DataType)

			// Prefer INFORMATION_SCHEMA dimension values over parsed ones
			fLen := c.CharMaxLen
			if fLen == nil {
				fLen = normLen
			}
			fPrec := c.NumPrecision
			if fPrec == nil {
				fPrec = normPrec
			}
			fScale := c.NumScale
			if fScale == nil {
				fScale = normScale
			}

			f := schema.Field{
				ID:         fID,
				Name:       c.ColumnName,
				Type:       genericType,
				Nullable:   c.IsNullable,
				PrimaryKey: pkSet[tblName+"."+c.ColumnName],
				Length:     fLen,
				Precision:  fPrec,
				Scale:      fScale,
			}

			// Store the original raw data type as a dialect-specific override
			rawLower := strings.ToLower(strings.TrimSpace(c.DataType))
			if dialect != "" && rawLower != genericType {
				f.TypeOverrides = map[string]schema.FieldTypeOverride{
					dialect: {Type: rawLower},
				}
			}

			fields = append(fields, f)
		}

		row, col := i/cols, i%cols
		tables = append(tables, schema.Table{
			ID:     tID,
			Name:   tblName,
			X:      float64(col * 320),
			Y:      float64(row * 240),
			Fields: fields,
		})
	}

	// Build relationships from FK data
	var rels []schema.Relationship
	for _, fk := range fks {
		srcTID := tableIDMap[fk.TargetTable]
		srcFID := fieldIDMap[fk.TargetTable+"."+fk.TargetColumn]
		tgtTID := tableIDMap[fk.SourceTable]
		tgtFID := fieldIDMap[fk.SourceTable+"."+fk.SourceColumn]
		if srcTID != "" && srcFID != "" && tgtTID != "" && tgtFID != "" {
			rels = append(rels, schema.Relationship{
				ID:            gen.rel(),
				SourceTableID: srcTID,
				SourceFieldID: srcFID,
				TargetTableID: tgtTID,
				TargetFieldID: tgtFID,
			})
		}
	}

	return schema.TableCatalog{
		ImportSource:  importSource,
		Tables:        tables,
		Relationships: rels,
	}
}
