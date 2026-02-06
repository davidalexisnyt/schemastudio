package sqlx

import (
	"bytes"
	"strings"

	"schemastudio/internal/schema"
)

// PostgresExporter generates PostgreSQL DDL with PRIMARY KEY and FOREIGN KEY.
type PostgresExporter struct{}

func (p *PostgresExporter) Dialect() string { return "postgres" }

func (p *PostgresExporter) Export(d schema.Diagram) (string, error) {
	return ExportPostgresWithSchema(d, "")
}

// ExportPostgresWithSchema returns PostgreSQL DDL. If schemaName is non-empty,
// table names are qualified as "schema"."table".
func ExportPostgresWithSchema(d schema.Diagram, schemaName string) (string, error) {
	var b bytes.Buffer
	tableByID := make(map[string]*schema.Table)
	for i := range d.Tables {
		tableByID[d.Tables[i].ID] = &d.Tables[i]
	}
	for _, t := range d.Tables {
		tblName := qualifiedTableName(schemaName, t.Name)
		b.WriteString("create table ")
		b.WriteString(tblName)
		b.WriteString(" (\n")
		var pk []string
		for i, f := range t.Fields {
			if i > 0 {
				b.WriteString(",\n")
			}
			b.WriteString("  ")
			b.WriteString(quoteIdent(f.Name))
			b.WriteString(" ")
			b.WriteString(DefaultExportType("postgres", f.Type, f.Length, f.Precision, f.Scale, f.TypeOverrides))
			if !f.Nullable {
				b.WriteString(" not null")
			}
			if f.PrimaryKey {
				pk = append(pk, f.Name)
			}
		}
		if len(pk) > 0 {
			b.WriteString(",\n  primary key (")
			for i, name := range pk {
				if i > 0 {
					b.WriteString(", ")
				}
				b.WriteString(quoteIdent(name))
			}
			b.WriteString(")")
		}
		for _, r := range d.Relationships {
			if r.TargetTableID != t.ID {
				continue
			}
			srcT := tableByID[r.SourceTableID]
			if srcT == nil {
				continue
			}
			srcFieldIDs := r.SourceFieldIDs
			tgtFieldIDs := r.TargetFieldIDs
			if len(srcFieldIDs) == 0 {
				srcFieldIDs = []string{r.SourceFieldID}
			}
			if len(tgtFieldIDs) == 0 {
				tgtFieldIDs = []string{r.TargetFieldID}
			}
			n := len(srcFieldIDs)
			if len(tgtFieldIDs) < n {
				n = len(tgtFieldIDs)
			}
			for i := 0; i < n; i++ {
				var srcF, tgtF string
				for _, f := range srcT.Fields {
					if f.ID == srcFieldIDs[i] {
						srcF = f.Name
						break
					}
				}
				for _, f := range t.Fields {
					if f.ID == tgtFieldIDs[i] {
						tgtF = f.Name
						break
					}
				}
				if srcF != "" && tgtF != "" {
					srcTblName := qualifiedTableName(schemaName, srcT.Name)
					b.WriteString(",\n  foreign key (")
					b.WriteString(quoteIdent(tgtF))
					b.WriteString(") references ")
					b.WriteString(srcTblName)
					b.WriteString(" (")
					b.WriteString(quoteIdent(srcF))
					b.WriteString(")")
				}
			}
		}
		b.WriteString("\n);\n\n")
	}
	return b.String(), nil
}

func quoteIdent(s string) string {
	if !strings.Contains(s, " ") {
		return s
	}
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func qualifiedTableName(schemaName, tableName string) string {
	q := quoteIdent(tableName)
	if schemaName == "" {
		return q
	}
	return quoteIdent(schemaName) + "." + q
}

