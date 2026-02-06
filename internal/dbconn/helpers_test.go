package dbconn

import (
	"testing"
)

func TestBuildCatalog_Basic(t *testing.T) {
	columns := []columnInfo{
		{TableName: "users", ColumnName: "id", DataType: "integer", IsNullable: false, OrdinalPos: 1},
		{TableName: "users", ColumnName: "name", DataType: "varchar", IsNullable: true, OrdinalPos: 2},
		{TableName: "users", ColumnName: "email", DataType: "varchar", IsNullable: false, OrdinalPos: 3},
		{TableName: "orders", ColumnName: "id", DataType: "integer", IsNullable: false, OrdinalPos: 1},
		{TableName: "orders", ColumnName: "user_id", DataType: "integer", IsNullable: false, OrdinalPos: 2},
		{TableName: "orders", ColumnName: "total", DataType: "numeric", IsNullable: true, OrdinalPos: 3},
	}

	pks := []pkInfo{
		{TableName: "users", ColumnName: "id"},
		{TableName: "orders", ColumnName: "id"},
	}

	fks := []fkInfo{
		{SourceTable: "orders", SourceColumn: "user_id", TargetTable: "users", TargetColumn: "id"},
	}

	catalog := buildCatalog(columns, pks, fks, "test (PostgreSQL)")

	if catalog.ImportSource != "test (PostgreSQL)" {
		t.Errorf("expected import source 'test (PostgreSQL)', got %q", catalog.ImportSource)
	}

	if len(catalog.Tables) != 2 {
		t.Fatalf("expected 2 tables, got %d", len(catalog.Tables))
	}

	// Tables should be sorted alphabetically
	if catalog.Tables[0].Name != "orders" {
		t.Errorf("expected first table 'orders', got %q", catalog.Tables[0].Name)
	}
	if catalog.Tables[1].Name != "users" {
		t.Errorf("expected second table 'users', got %q", catalog.Tables[1].Name)
	}

	// Check fields count
	ordersTable := catalog.Tables[0]
	usersTable := catalog.Tables[1]

	if len(ordersTable.Fields) != 3 {
		t.Errorf("expected 3 fields in orders, got %d", len(ordersTable.Fields))
	}
	if len(usersTable.Fields) != 3 {
		t.Errorf("expected 3 fields in users, got %d", len(usersTable.Fields))
	}

	// Check PK marking
	usersIDField := usersTable.Fields[0]
	if usersIDField.Name != "id" {
		t.Errorf("expected first field 'id', got %q", usersIDField.Name)
	}
	if !usersIDField.PrimaryKey {
		t.Error("expected users.id to be primary key")
	}

	usersNameField := usersTable.Fields[1]
	if usersNameField.PrimaryKey {
		t.Error("expected users.name to NOT be primary key")
	}

	// Check nullable
	if usersIDField.Nullable {
		t.Error("expected users.id to NOT be nullable")
	}
	if !usersNameField.Nullable {
		t.Error("expected users.name to be nullable")
	}

	// Check relationships
	if len(catalog.Relationships) != 1 {
		t.Fatalf("expected 1 relationship, got %d", len(catalog.Relationships))
	}

	rel := catalog.Relationships[0]
	// The FK is orders.user_id -> users.id
	// In buildCatalog, source = target table (users), target = source table (orders)
	if rel.SourceTableID != usersTable.ID {
		t.Errorf("expected rel source table %s, got %s", usersTable.ID, rel.SourceTableID)
	}
	if rel.TargetTableID != ordersTable.ID {
		t.Errorf("expected rel target table %s, got %s", ordersTable.ID, rel.TargetTableID)
	}
}

func TestBuildCatalog_EmptyInput(t *testing.T) {
	catalog := buildCatalog(nil, nil, nil, "empty")
	if len(catalog.Tables) != 0 {
		t.Errorf("expected 0 tables, got %d", len(catalog.Tables))
	}
	if catalog.Relationships != nil {
		t.Errorf("expected nil relationships, got %v", catalog.Relationships)
	}
}

func TestBuildCatalog_GridLayout(t *testing.T) {
	// Create 5 tables to test grid layout (3 columns)
	var columns []columnInfo
	for _, tbl := range []string{"a", "b", "c", "d", "e"} {
		columns = append(columns, columnInfo{
			TableName: tbl, ColumnName: "id", DataType: "int", IsNullable: false, OrdinalPos: 1,
		})
	}

	catalog := buildCatalog(columns, nil, nil, "grid-test")

	if len(catalog.Tables) != 5 {
		t.Fatalf("expected 5 tables, got %d", len(catalog.Tables))
	}

	// Check positions: 3 columns, spacing 320x240
	expected := [][2]float64{
		{0, 0},     // a: row 0, col 0
		{320, 0},   // b: row 0, col 1
		{640, 0},   // c: row 0, col 2
		{0, 240},   // d: row 1, col 0
		{320, 240}, // e: row 1, col 1
	}

	for i, tbl := range catalog.Tables {
		if tbl.X != expected[i][0] || tbl.Y != expected[i][1] {
			t.Errorf("table %q: expected position (%.0f, %.0f), got (%.0f, %.0f)",
				tbl.Name, expected[i][0], expected[i][1], tbl.X, tbl.Y)
		}
	}
}

func TestBuildCatalog_TypesLowercased(t *testing.T) {
	columns := []columnInfo{
		{TableName: "t1", ColumnName: "col1", DataType: "VARCHAR", IsNullable: false, OrdinalPos: 1},
		{TableName: "t1", ColumnName: "col2", DataType: "INTEGER", IsNullable: false, OrdinalPos: 2},
	}

	catalog := buildCatalog(columns, nil, nil, "types-test")
	if catalog.Tables[0].Fields[0].Type != "varchar" {
		t.Errorf("expected type 'varchar', got %q", catalog.Tables[0].Fields[0].Type)
	}
	if catalog.Tables[0].Fields[1].Type != "integer" {
		t.Errorf("expected type 'integer', got %q", catalog.Tables[0].Fields[1].Type)
	}
}

func TestBuildCatalog_FKUnresolvedIgnored(t *testing.T) {
	columns := []columnInfo{
		{TableName: "orders", ColumnName: "id", DataType: "int", IsNullable: false, OrdinalPos: 1},
	}
	// FK references a table that doesn't exist in the columns
	fks := []fkInfo{
		{SourceTable: "orders", SourceColumn: "user_id", TargetTable: "users", TargetColumn: "id"},
	}

	catalog := buildCatalog(columns, nil, fks, "fk-unresolved")
	if len(catalog.Relationships) != 0 {
		t.Errorf("expected 0 relationships (unresolved FK), got %d", len(catalog.Relationships))
	}
}

func TestIDGen(t *testing.T) {
	gen := newIDGen()

	if got := gen.table(); got != "t1" {
		t.Errorf("expected t1, got %s", got)
	}
	if got := gen.table(); got != "t2" {
		t.Errorf("expected t2, got %s", got)
	}
	if got := gen.field(); got != "f1" {
		t.Errorf("expected f1, got %s", got)
	}
	if got := gen.rel(); got != "r1" {
		t.Errorf("expected r1, got %s", got)
	}
}

func TestPlaceholderFunctions(t *testing.T) {
	if got := pgPlaceholder(1); got != "$1" {
		t.Errorf("pgPlaceholder(1) = %q, want $1", got)
	}
	if got := pgPlaceholder(5); got != "$5" {
		t.Errorf("pgPlaceholder(5) = %q, want $5", got)
	}
	if got := mysqlPlaceholder(1); got != "?" {
		t.Errorf("mysqlPlaceholder(1) = %q, want ?", got)
	}
	if got := mssqlPlaceholder(1); got != "@p1" {
		t.Errorf("mssqlPlaceholder(1) = %q, want @p1", got)
	}
	if got := mssqlPlaceholder(3); got != "@p3" {
		t.Errorf("mssqlPlaceholder(3) = %q, want @p3", got)
	}
}
