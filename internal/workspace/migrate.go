package workspace

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"schemastudio/internal/sqlx"
)

// MigrationResult reports the outcome of a workspace migration.
type MigrationResult struct {
	TablesImported   int      `json:"tablesImported"`
	DiagramsImported int      `json:"diagramsImported"`
	RelationshipsImported int `json:"relationshipsImported"`
	Warnings         []string `json:"warnings"`
	Errors           []string `json:"errors"`
}

// --- Legacy JSON structures (matching the old file-based format) ---

type legacyWorkspaceConfig struct {
	Name             string `json:"name"`
	Description      string `json:"description,omitempty"`
	AutoSaveDiagrams bool   `json:"autoSaveDiagrams,omitempty"`
}

type legacyCatalogTable struct {
	ID     string        `json:"id"`
	Name   string        `json:"name"`
	X      float64       `json:"x"`
	Y      float64       `json:"y"`
	Fields []legacyField `json:"fields"`
}

type legacyField struct {
	ID            string                           `json:"id"`
	Name          string                           `json:"name"`
	Type          string                           `json:"type"`
	Nullable      bool                             `json:"nullable,omitempty"`
	PrimaryKey    bool                             `json:"primaryKey,omitempty"`
	Length        *int                             `json:"length,omitempty"`
	Precision     *int                             `json:"precision,omitempty"`
	Scale         *int                             `json:"scale,omitempty"`
	TypeOverrides map[string]legacyFieldTypeOverride `json:"typeOverrides,omitempty"`
}

type legacyFieldTypeOverride struct {
	Type string `json:"type"`
}

type legacyCatalogRelationship struct {
	ID                   string `json:"id"`
	SourceCatalogTableID string `json:"sourceCatalogTableId"`
	TargetCatalogTableID string `json:"targetCatalogTableId"`
	SourceFieldName      string `json:"sourceFieldName"`
	TargetFieldName      string `json:"targetFieldName"`
}

type legacyDiagram struct {
	Version       int                  `json:"version"`
	Tables        []legacyDiagramTable `json:"tables"`
	Relationships []legacyRelationship `json:"relationships"`
	Notes         []legacyNote         `json:"notes,omitempty"`
	TextBlocks    []legacyTextBlock    `json:"textBlocks,omitempty"`
	Viewport      *legacyViewport      `json:"viewport,omitempty"`
}

type legacyDiagramTable struct {
	ID             string        `json:"id"`
	Name           string        `json:"name"`
	X              float64       `json:"x"`
	Y              float64       `json:"y"`
	Fields         []legacyField `json:"fields"`
	CatalogTableID string        `json:"catalogTableId,omitempty"`
}

type legacyRelationship struct {
	ID                      string   `json:"id"`
	SourceTableID           string   `json:"sourceTableId"`
	SourceFieldID           string   `json:"sourceFieldId"`
	TargetTableID           string   `json:"targetTableId"`
	TargetFieldID           string   `json:"targetFieldId"`
	Label                   string   `json:"label,omitempty"`
	SourceFieldIDs          []string `json:"sourceFieldIds,omitempty"`
	TargetFieldIDs          []string `json:"targetFieldIds,omitempty"`
	Name                    string   `json:"name,omitempty"`
	Note                    string   `json:"note,omitempty"`
	Cardinality             string   `json:"cardinality,omitempty"`
	CatalogRelationshipID   string   `json:"catalogRelationshipId,omitempty"`
}

type legacyNote struct {
	ID     string   `json:"id"`
	X      float64  `json:"x"`
	Y      float64  `json:"y"`
	Text   string   `json:"text"`
	Width  *float64 `json:"width,omitempty"`
	Height *float64 `json:"height,omitempty"`
}

type legacyTextBlock struct {
	ID          string   `json:"id"`
	X           float64  `json:"x"`
	Y           float64  `json:"y"`
	Text        string   `json:"text"`
	Width       *float64 `json:"width,omitempty"`
	Height      *float64 `json:"height,omitempty"`
	FontSize    *float64 `json:"fontSize,omitempty"`
	UseMarkdown bool     `json:"useMarkdown,omitempty"`
}

type legacyViewport struct {
	Zoom float64 `json:"zoom"`
	PanX float64 `json:"panX"`
	PanY float64 `json:"panY"`
}

type legacyUIState struct {
	CatalogOpen              *bool    `json:"catalogOpen,omitempty"`
	DiagramsOpen             *bool    `json:"diagramsOpen,omitempty"`
	SettingsOpen             *bool    `json:"settingsOpen,omitempty"`
	SidebarScrollTop         *float64 `json:"sidebarScrollTop,omitempty"`
	CatalogContentScrollTop  *float64 `json:"catalogContentScrollTop,omitempty"`
	DiagramsContentScrollTop *float64 `json:"diagramsContentScrollTop,omitempty"`
}

// Valid generic types.
var validGenericTypes = map[string]bool{
	"string": true, "integer": true, "float": true, "numeric": true,
	"boolean": true, "date": true, "time": true, "timestamp": true,
	"timestamptz": true, "uuid": true, "json": true, "bytes": true,
	"other": true,
}

// Valid dialect names.
var validDialects = map[string]bool{
	"postgres": true, "mysql": true, "mssql": true, "bigquery": true,
}

// MigrateFromFolder reads the legacy file-based workspace at oldRootPath,
// validates and normalizes data, and writes it into a new .schemastudio
// SQLite database at newFilePath.
func MigrateFromFolder(oldRootPath, newFilePath string) (MigrationResult, error) {
	result := MigrationResult{}

	// Create the new workspace database.
	db, err := OpenDB(newFilePath)
	if err != nil {
		return result, fmt.Errorf("create workspace db: %w", err)
	}
	if err := InitSchema(db); err != nil {
		db.Close()
		return result, fmt.Errorf("init schema: %w", err)
	}
	repo := NewRepo(db, newFilePath)
	defer repo.Close()

	// --- 1. Workspace config ---
	configPath := filepath.Join(oldRootPath, "workspace.config.json")
	configData, err := os.ReadFile(configPath)
	if err != nil {
		result.Warnings = append(result.Warnings, "workspace.config.json not found; using defaults")
	} else {
		var config legacyWorkspaceConfig
		if err := json.Unmarshal(configData, &config); err != nil {
			result.Warnings = append(result.Warnings, "workspace.config.json parse error: "+err.Error())
		} else {
			repo.SaveAllSettings(WorkspaceSettings{
				Name:             config.Name,
				Description:      config.Description,
				AutoSaveDiagrams: config.AutoSaveDiagrams,
			})
		}
	}

	// --- 2. Table catalog ---
	catalogPath := filepath.Join(oldRootPath, "table_catalog.json")
	catalogData, err := os.ReadFile(catalogPath)
	if err != nil {
		result.Warnings = append(result.Warnings, "table_catalog.json not found; skipping catalog import")
	} else {
		var tables []legacyCatalogTable
		if err := json.Unmarshal(catalogData, &tables); err != nil {
			result.Errors = append(result.Errors, "table_catalog.json parse error: "+err.Error())
		} else {
			for i, t := range tables {
				ct := CatalogTable{
					ID:        t.ID,
					Name:      t.Name,
					SortOrder: i,
				}
				for j, f := range t.Fields {
					cf := migrateCatalogField(f, t.ID, j, &result)
					ct.Fields = append(ct.Fields, cf)
				}
				if err := repo.SaveCatalogTable(ct); err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("save table %q: %s", t.Name, err.Error()))
				} else {
					result.TablesImported++
				}
			}
		}
	}

	// --- 3. Catalog relationships ---
	relsPath := filepath.Join(oldRootPath, "catalog_relationships.json")
	relsData, err := os.ReadFile(relsPath)
	if err != nil {
		result.Warnings = append(result.Warnings, "catalog_relationships.json not found; skipping relationships")
	} else {
		var rels []legacyCatalogRelationship
		if err := json.Unmarshal(relsData, &rels); err != nil {
			result.Errors = append(result.Errors, "catalog_relationships.json parse error: "+err.Error())
		} else {
			// Load all catalog tables to resolve field names -> IDs.
			allTables, _ := repo.ListCatalogTables()
			tablesByID := make(map[string]*CatalogTable)
			for i := range allTables {
				tablesByID[allTables[i].ID] = &allTables[i]
			}

			for _, r := range rels {
				cr := CatalogRelationship{
					ID:            r.ID,
					SourceTableID: r.SourceCatalogTableID,
					TargetTableID: r.TargetCatalogTableID,
				}
				// Validate that source/target tables exist.
				srcTable := tablesByID[r.SourceCatalogTableID]
				tgtTable := tablesByID[r.TargetCatalogTableID]
				if srcTable == nil {
					result.Warnings = append(result.Warnings, fmt.Sprintf("relationship %s: source table %s not found", r.ID, r.SourceCatalogTableID))
					continue
				}
				if tgtTable == nil {
					result.Warnings = append(result.Warnings, fmt.Sprintf("relationship %s: target table %s not found", r.ID, r.TargetCatalogTableID))
					continue
				}
				// Resolve field names to IDs.
				var srcFieldID, tgtFieldID string
				for _, f := range srcTable.Fields {
					if f.Name == r.SourceFieldName {
						srcFieldID = f.ID
						break
					}
				}
				for _, f := range tgtTable.Fields {
					if f.Name == r.TargetFieldName {
						tgtFieldID = f.ID
						break
					}
				}
				if srcFieldID == "" {
					result.Warnings = append(result.Warnings, fmt.Sprintf("relationship %s: source field %q not found in table %q", r.ID, r.SourceFieldName, srcTable.Name))
				}
				if tgtFieldID == "" {
					result.Warnings = append(result.Warnings, fmt.Sprintf("relationship %s: target field %q not found in table %q", r.ID, r.TargetFieldName, tgtTable.Name))
				}
				if srcFieldID != "" && tgtFieldID != "" {
					cr.Fields = []CatalogRelationshipField{{
						RelationshipID: r.ID,
						SourceFieldID:  srcFieldID,
						TargetFieldID:  tgtFieldID,
						SortOrder:      0,
					}}
				}
				if err := repo.SaveCatalogRelationship(cr); err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("save relationship %s: %s", r.ID, err.Error()))
				} else {
					result.RelationshipsImported++
				}
			}
		}
	}

	// --- 4. Diagrams ---
	// Look for .diagram files in the root folder and also in a diagrams/ subfolder.
	diagramFiles, _ := filepath.Glob(filepath.Join(oldRootPath, "*.diagram"))
	subDiagramFiles, _ := filepath.Glob(filepath.Join(oldRootPath, "diagrams", "*.diagram"))
	diagramFiles = append(diagramFiles, subDiagramFiles...)
	allTables, _ := repo.ListCatalogTables()
	tablesByID := make(map[string]*CatalogTable)
	for i := range allTables {
		tablesByID[allTables[i].ID] = &allTables[i]
	}
	allRels, _ := repo.ListCatalogRelationships()
	relsByID := make(map[string]*CatalogRelationship)
	for i := range allRels {
		relsByID[allRels[i].ID] = &allRels[i]
	}

	// Track catalog relationships we auto-create from diagram data so we
	// don't duplicate them across diagrams that share the same relationship.
	autoCreatedRels := make(map[string]string) // key: "srcCatalogTableID|srcFieldID|tgtCatalogTableID|tgtFieldID" -> catalogRelID

	for _, diagPath := range diagramFiles {
		data, err := os.ReadFile(diagPath)
		if err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("cannot read %s: %s", filepath.Base(diagPath), err.Error()))
			continue
		}
		var ld legacyDiagram
		if err := json.Unmarshal(data, &ld); err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("cannot parse %s: %s", filepath.Base(diagPath), err.Error()))
			continue
		}

		baseName := filepath.Base(diagPath)
		diagName := strings.TrimSuffix(baseName, filepath.Ext(baseName))
		diagID := "diag-" + diagName

		diagram := Diagram{
			ID:      diagID,
			Name:    diagName,
			Version: ld.Version,
		}
		if ld.Viewport != nil {
			diagram.ViewportZoom = ld.Viewport.Zoom
			diagram.ViewportPanX = ld.Viewport.PanX
			diagram.ViewportPanY = ld.Viewport.PanY
		} else {
			diagram.ViewportZoom = 1
		}

		// Build a map from diagram table ID -> diagram table (for field/catalog resolution).
		diagTablesByID := make(map[string]*legacyDiagramTable)
		for i := range ld.Tables {
			diagTablesByID[ld.Tables[i].ID] = &ld.Tables[i]
		}

		// Table placements: only migrate tables that have a catalog link.
		for _, dt := range ld.Tables {
			if dt.CatalogTableID == "" {
				result.Warnings = append(result.Warnings, fmt.Sprintf("diagram %s: table %q has no catalog link; skipped", diagName, dt.Name))
				continue
			}
			if tablesByID[dt.CatalogTableID] == nil {
				result.Warnings = append(result.Warnings, fmt.Sprintf("diagram %s: table %q references unknown catalog table %s", diagName, dt.Name, dt.CatalogTableID))
				continue
			}
			diagram.Tables = append(diagram.Tables, DiagramTablePlacement{
				ID:             dt.ID,
				DiagramID:      diagID,
				CatalogTableID: dt.CatalogTableID,
				X:              dt.X,
				Y:              dt.Y,
			})
		}

		// Relationship placements.
		for _, dr := range ld.Relationships {
			catalogRelID := dr.CatalogRelationshipID

			if catalogRelID != "" {
				// Already linked to a catalog relationship -- verify it exists.
				if relsByID[catalogRelID] == nil {
					result.Warnings = append(result.Warnings, fmt.Sprintf("diagram %s: relationship %s references unknown catalog relationship %s", diagName, dr.ID, catalogRelID))
					continue
				}
			} else {
				// No catalog link -- auto-create a catalog relationship from the diagram data.
				// Resolve diagram table IDs to catalog table IDs.
				srcDiagTable := diagTablesByID[dr.SourceTableID]
				tgtDiagTable := diagTablesByID[dr.TargetTableID]
				if srcDiagTable == nil || tgtDiagTable == nil {
					result.Warnings = append(result.Warnings, fmt.Sprintf("diagram %s: relationship %s references unknown diagram table(s); skipped", diagName, dr.ID))
					continue
				}
				srcCatalogTableID := srcDiagTable.CatalogTableID
				tgtCatalogTableID := tgtDiagTable.CatalogTableID
				if srcCatalogTableID == "" || tgtCatalogTableID == "" {
					result.Warnings = append(result.Warnings, fmt.Sprintf("diagram %s: relationship %s: source/target table(s) have no catalog link; skipped", diagName, dr.ID))
					continue
				}
				srcCatalogTable := tablesByID[srcCatalogTableID]
				tgtCatalogTable := tablesByID[tgtCatalogTableID]
				if srcCatalogTable == nil || tgtCatalogTable == nil {
					result.Warnings = append(result.Warnings, fmt.Sprintf("diagram %s: relationship %s: catalog table(s) not found; skipped", diagName, dr.ID))
					continue
				}

				// Resolve diagram field IDs to catalog field IDs.
				// Field IDs in diagrams that are linked to catalog tables use
				// the same IDs as the catalog fields, so we can match directly.
				srcFieldID := dr.SourceFieldID
				tgtFieldID := dr.TargetFieldID

				// Check if we already created an equivalent catalog relationship.
				dedupKey := srcCatalogTableID + "|" + srcFieldID + "|" + tgtCatalogTableID + "|" + tgtFieldID
				if existingID, ok := autoCreatedRels[dedupKey]; ok {
					catalogRelID = existingID
				} else {
					// Create a new catalog relationship.
					catalogRelID = "catrel-" + dr.ID
					cr := CatalogRelationship{
						ID:            catalogRelID,
						SourceTableID: srcCatalogTableID,
						TargetTableID: tgtCatalogTableID,
						Name:          dr.Name,
						Note:          dr.Note,
						Cardinality:   dr.Cardinality,
					}

					// Set field mappings if we can verify the fields exist in the catalog.
					srcFieldExists := false
					tgtFieldExists := false
					for _, f := range srcCatalogTable.Fields {
						if f.ID == srcFieldID {
							srcFieldExists = true
							break
						}
					}
					for _, f := range tgtCatalogTable.Fields {
						if f.ID == tgtFieldID {
							tgtFieldExists = true
							break
						}
					}
					if srcFieldExists && tgtFieldExists {
						cr.Fields = []CatalogRelationshipField{{
							RelationshipID: catalogRelID,
							SourceFieldID:  srcFieldID,
							TargetFieldID:  tgtFieldID,
							SortOrder:      0,
						}}
					} else {
						if !srcFieldExists {
							result.Warnings = append(result.Warnings, fmt.Sprintf("diagram %s: relationship %s: source field %s not found in catalog table %q", diagName, dr.ID, srcFieldID, srcCatalogTable.Name))
						}
						if !tgtFieldExists {
							result.Warnings = append(result.Warnings, fmt.Sprintf("diagram %s: relationship %s: target field %s not found in catalog table %q", diagName, dr.ID, tgtFieldID, tgtCatalogTable.Name))
						}
					}

					if err := repo.SaveCatalogRelationship(cr); err != nil {
						result.Errors = append(result.Errors, fmt.Sprintf("auto-create catalog relationship for diagram %s rel %s: %s", diagName, dr.ID, err.Error()))
						continue
					}
					autoCreatedRels[dedupKey] = catalogRelID
					relsByID[catalogRelID] = &cr
					result.RelationshipsImported++
				}
			}

			diagram.Relationships = append(diagram.Relationships, DiagramRelationshipPlacement{
				ID:                    dr.ID,
				DiagramID:             diagID,
				CatalogRelationshipID: catalogRelID,
				Label:                 dr.Label,
			})
		}

		// Notes.
		for _, n := range ld.Notes {
			diagram.Notes = append(diagram.Notes, DiagramNote{
				ID:        n.ID,
				DiagramID: diagID,
				X:         n.X,
				Y:         n.Y,
				Text:      n.Text,
				Width:     n.Width,
				Height:    n.Height,
			})
		}

		// Text blocks.
		for _, tb := range ld.TextBlocks {
			diagram.TextBlocks = append(diagram.TextBlocks, DiagramTextBlock{
				ID:          tb.ID,
				DiagramID:   diagID,
				X:           tb.X,
				Y:           tb.Y,
				Text:        tb.Text,
				Width:       tb.Width,
				Height:      tb.Height,
				FontSize:    tb.FontSize,
				UseMarkdown: tb.UseMarkdown,
			})
		}

		if err := repo.SaveDiagram(diagram); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("save diagram %q: %s", diagName, err.Error()))
		} else {
			result.DiagramsImported++
		}
	}

	// --- 5. UI state ---
	statePath := filepath.Join(oldRootPath, "workspace.state")
	stateData, err := os.ReadFile(statePath)
	if err == nil {
		var ui legacyUIState
		if err := json.Unmarshal(stateData, &ui); err == nil {
			kvState := make(UIState)
			if ui.CatalogOpen != nil {
				kvState["catalogOpen"] = fmt.Sprintf("%t", *ui.CatalogOpen)
			}
			if ui.DiagramsOpen != nil {
				kvState["diagramsOpen"] = fmt.Sprintf("%t", *ui.DiagramsOpen)
			}
			if ui.SettingsOpen != nil {
				kvState["settingsOpen"] = fmt.Sprintf("%t", *ui.SettingsOpen)
			}
			if ui.SidebarScrollTop != nil {
				kvState["sidebarScrollTop"] = fmt.Sprintf("%.0f", *ui.SidebarScrollTop)
			}
			if ui.CatalogContentScrollTop != nil {
				kvState["catalogContentScrollTop"] = fmt.Sprintf("%.0f", *ui.CatalogContentScrollTop)
			}
			if ui.DiagramsContentScrollTop != nil {
				kvState["diagramsContentScrollTop"] = fmt.Sprintf("%.0f", *ui.DiagramsContentScrollTop)
			}
			repo.SaveUIState(kvState)
		}
	}

	return result, nil
}

// migrateCatalogField converts a legacy field to a CatalogField, normalizing the type.
func migrateCatalogField(f legacyField, tableID string, sortOrder int, result *MigrationResult) CatalogField {
	cf := CatalogField{
		ID:        f.ID,
		TableID:   tableID,
		Name:      f.Name,
		Nullable:  f.Nullable,
		PrimaryKey: f.PrimaryKey,
		Length:    f.Length,
		Precision: f.Precision,
		Scale:     f.Scale,
		SortOrder: sortOrder,
	}

	// Normalize the type.
	if validGenericTypes[f.Type] {
		cf.Type = f.Type
	} else {
		normalized, length, precision, scale := sqlx.NormalizeType(f.Type)
		cf.Type = normalized
		if cf.Length == nil && length != nil {
			cf.Length = length
		}
		if cf.Precision == nil && precision != nil {
			cf.Precision = precision
		}
		if cf.Scale == nil && scale != nil {
			cf.Scale = scale
		}
		result.Warnings = append(result.Warnings, fmt.Sprintf("field %q: type %q normalized to %q", f.Name, f.Type, normalized))
	}

	// Migrate type overrides.
	for dialect, ov := range f.TypeOverrides {
		canonDialect := strings.ToLower(dialect)
		if !validDialects[canonDialect] {
			result.Warnings = append(result.Warnings, fmt.Sprintf("field %q: unknown dialect %q in type override", f.Name, dialect))
			canonDialect = dialect
		}
		cf.TypeOverrides = append(cf.TypeOverrides, CatalogFieldTypeOverride{
			FieldID:      f.ID,
			Dialect:      canonDialect,
			TypeOverride: ov.Type,
		})

		// If the field has no length/precision/scale but the override contains them, try to extract.
		if cf.Length == nil && cf.Precision == nil {
			_, length, precision, scale := sqlx.NormalizeType(ov.Type)
			if cf.Length == nil && length != nil {
				cf.Length = length
			}
			if cf.Precision == nil && precision != nil {
				cf.Precision = precision
			}
			if cf.Scale == nil && scale != nil {
				cf.Scale = scale
			}
		}
	}

	return cf
}
