package importers

import (
	"encoding/csv"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"schemastudio/internal/schema"
	"schemastudio/internal/sqlx"
)

// ParseCSV parses a CSV with columns: schema, table, column, type, is_nullable, field_order.
// Returns a TableCatalog. Rows are grouped by table name; fields are sorted by field_order.
// ImportSource is left empty; the caller should set it to the file name.
func ParseCSV(csvContent string) (schema.TableCatalog, error) {
	catalog := schema.TableCatalog{Tables: []schema.Table{}, Relationships: []schema.Relationship{}}
	r := csv.NewReader(strings.NewReader(csvContent))
	rows, err := r.ReadAll()
	if err != nil {
		return catalog, err
	}
	if len(rows) < 2 {
		return catalog, nil
	}
	header := rows[0]
	colIdx := make(map[string]int)
	for i, h := range header {
		colIdx[strings.TrimSpace(strings.ToLower(h))] = i
	}
	tableIdx, okT := colIdx["table"]
	columnIdx, okC := colIdx["column"]
	typeIdx, okType := colIdx["type"]
	nullableIdx, okN := colIdx["is_nullable"]
	orderIdx, okO := colIdx["field_order"]
	if !okT || !okC || !okType {
		return catalog, fmt.Errorf("CSV must have columns: table, column, type")
	}

	// Group rows by table name: tableName -> list of row indices (with field_order for sorting)
	type rowOrder struct {
		rowIndex int
		order    int
	}
	tableRows := make(map[string][]rowOrder)
	for i := 1; i < len(rows); i++ {
		row := rows[i]
		if tableIdx >= len(row) || columnIdx >= len(row) || typeIdx >= len(row) {
			continue
		}
		tableName := strings.TrimSpace(row[tableIdx])
		if tableName == "" {
			continue
		}
		order := 0
		if okO && orderIdx < len(row) {
			order, _ = strconv.Atoi(strings.TrimSpace(row[orderIdx]))
		}
		tableRows[tableName] = append(tableRows[tableName], rowOrder{rowIndex: i, order: order})
	}

	// Sort each table's rows by field_order, then build Table and Fields
	idGen := newIDGen()
	tableOrder := make([]string, 0, len(tableRows))
	for k := range tableRows {
		tableOrder = append(tableOrder, k)
	}
	sort.Strings(tableOrder)

	cols := 3
	for ti, tableName := range tableOrder {
		rowOrders := tableRows[tableName]
		sort.Slice(rowOrders, func(a, b int) bool { return rowOrders[a].order < rowOrders[b].order })
		tID := idGen.table()
		t := schema.Table{
			ID:     tID,
			Name:   tableName,
			X:      0,
			Y:      0,
			Fields: []schema.Field{},
		}
		for _, ro := range rowOrders {
			row := rows[ro.rowIndex]
			colName := strings.TrimSpace(row[columnIdx])
			rawType := "string"
			if typeIdx < len(row) {
				rawType = strings.TrimSpace(row[typeIdx])
			}
			genericType, length, precision, scale := sqlx.NormalizeType(rawType)
			nullable := true
			if okN && nullableIdx < len(row) {
				v := strings.TrimSpace(strings.ToLower(row[nullableIdx]))
				nullable = v == "yes" || v == "true" || v == "1"
			}
			fID := idGen.field()
			t.Fields = append(t.Fields, schema.Field{
				ID:        fID,
				Name:      colName,
				Type:      genericType,
				Nullable:  nullable,
				Length:    length,
				Precision: precision,
				Scale:     scale,
			})
		}
		row, col := ti/cols, ti%cols
		t.X = float64(col * 320)
		t.Y = float64(row * 240)
		catalog.Tables = append(catalog.Tables, t)
	}
	return catalog, nil
}
