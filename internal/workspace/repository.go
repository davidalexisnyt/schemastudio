package workspace

import (
	"database/sql"
	"fmt"
)

// WorkspaceRepo provides CRUD operations against a workspace SQLite database.
type WorkspaceRepo struct {
	db       *sql.DB
	filePath string
}

// NewRepo wraps an open database connection.
func NewRepo(db *sql.DB, filePath string) *WorkspaceRepo {
	return &WorkspaceRepo{db: db, filePath: filePath}
}

// FilePath returns the path to the .schemastudio file.
func (r *WorkspaceRepo) FilePath() string { return r.filePath }

// Close closes the underlying database connection.
func (r *WorkspaceRepo) Close() error { return r.db.Close() }

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// GetSetting returns a single setting value. Returns "" if not found.
func (r *WorkspaceRepo) GetSetting(key string) (string, error) {
	var value string
	err := r.db.QueryRow("SELECT value FROM workspace_settings WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

// SetSetting upserts a setting key-value pair.
func (r *WorkspaceRepo) SetSetting(key, value string) error {
	_, err := r.db.Exec(
		"INSERT INTO workspace_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		key, value,
	)
	return err
}

// GetAllSettings returns all workspace settings.
func (r *WorkspaceRepo) GetAllSettings() (WorkspaceSettings, error) {
	rows, err := r.db.Query("SELECT key, value FROM workspace_settings")
	if err != nil {
		return WorkspaceSettings{}, err
	}
	defer rows.Close()

	var s WorkspaceSettings
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return s, err
		}
		switch k {
		case "name":
			s.Name = v
		case "description":
			s.Description = v
		case "notation_style":
			s.NotationStyle = v
		}
	}
	return s, rows.Err()
}

// SaveAllSettings writes all workspace settings.
func (r *WorkspaceRepo) SaveAllSettings(s WorkspaceSettings) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	upsert := "INSERT INTO workspace_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
	if _, err := tx.Exec(upsert, "name", s.Name); err != nil {
		return err
	}
	if _, err := tx.Exec(upsert, "description", s.Description); err != nil {
		return err
	}
	if _, err := tx.Exec(upsert, "notation_style", s.NotationStyle); err != nil {
		return err
	}
	return tx.Commit()
}

// ---------------------------------------------------------------------------
// Catalog Tables
// ---------------------------------------------------------------------------

// ListCatalogTables returns all catalog tables with their fields and type overrides.
func (r *WorkspaceRepo) ListCatalogTables() ([]CatalogTable, error) {
	rows, err := r.db.Query("SELECT id, name, sort_order FROM catalog_tables ORDER BY sort_order, name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []CatalogTable
	for rows.Next() {
		var t CatalogTable
		if err := rows.Scan(&t.ID, &t.Name, &t.SortOrder); err != nil {
			return nil, err
		}
		tables = append(tables, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Load fields for each table.
	for i := range tables {
		fields, err := r.GetFieldsForTable(tables[i].ID)
		if err != nil {
			return nil, err
		}
		tables[i].Fields = fields
	}
	return tables, nil
}

// GetCatalogTable returns a single catalog table with its fields and type overrides.
func (r *WorkspaceRepo) GetCatalogTable(id string) (*CatalogTable, error) {
	var t CatalogTable
	err := r.db.QueryRow("SELECT id, name, sort_order FROM catalog_tables WHERE id = ?", id).
		Scan(&t.ID, &t.Name, &t.SortOrder)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	fields, err := r.GetFieldsForTable(t.ID)
	if err != nil {
		return nil, err
	}
	t.Fields = fields
	return &t, nil
}

// SaveCatalogTable upserts a catalog table and all its fields and type overrides.
// This replaces all fields for the table (delete + re-insert).
func (r *WorkspaceRepo) SaveCatalogTable(t CatalogTable) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Upsert table row.
	_, err = tx.Exec(
		`INSERT INTO catalog_tables (id, name, sort_order, updated_at)
		 VALUES (?, ?, ?, datetime('now'))
		 ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, updated_at=datetime('now')`,
		t.ID, t.Name, t.SortOrder,
	)
	if err != nil {
		return fmt.Errorf("upsert catalog_tables: %w", err)
	}

	// Delete existing fields (cascade deletes type overrides too).
	if _, err := tx.Exec("DELETE FROM catalog_fields WHERE table_id = ?", t.ID); err != nil {
		return fmt.Errorf("delete old fields: %w", err)
	}

	// Insert fields.
	for _, f := range t.Fields {
		_, err := tx.Exec(
			`INSERT INTO catalog_fields (id, table_id, name, type, nullable, primary_key, length, precision, scale, sort_order)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			f.ID, t.ID, f.Name, f.Type,
			boolToInt(f.Nullable), boolToInt(f.PrimaryKey),
			f.Length, f.Precision, f.Scale, f.SortOrder,
		)
		if err != nil {
			return fmt.Errorf("insert field %s: %w", f.ID, err)
		}
		// Insert type overrides.
		for _, o := range f.TypeOverrides {
			_, err := tx.Exec(
				"INSERT INTO catalog_field_type_overrides (field_id, dialect, type_override) VALUES (?, ?, ?)",
				f.ID, o.Dialect, o.TypeOverride,
			)
			if err != nil {
				return fmt.Errorf("insert type override: %w", err)
			}
		}
	}
	return tx.Commit()
}

// DeleteCatalogTable removes a catalog table and all its fields (via CASCADE).
func (r *WorkspaceRepo) DeleteCatalogTable(id string) error {
	_, err := r.db.Exec("DELETE FROM catalog_tables WHERE id = ?", id)
	return err
}

// ---------------------------------------------------------------------------
// Catalog Fields (standalone access)
// ---------------------------------------------------------------------------

// GetFieldsForTable returns all fields for a given table, with their type overrides.
func (r *WorkspaceRepo) GetFieldsForTable(tableID string) ([]CatalogField, error) {
	rows, err := r.db.Query(
		`SELECT id, table_id, name, type, nullable, primary_key, length, precision, scale, sort_order
		 FROM catalog_fields WHERE table_id = ? ORDER BY sort_order`,
		tableID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var fields []CatalogField
	for rows.Next() {
		var f CatalogField
		var nullable, pk int
		if err := rows.Scan(&f.ID, &f.TableID, &f.Name, &f.Type, &nullable, &pk,
			&f.Length, &f.Precision, &f.Scale, &f.SortOrder); err != nil {
			return nil, err
		}
		f.Nullable = nullable != 0
		f.PrimaryKey = pk != 0
		fields = append(fields, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Load type overrides for each field.
	for i := range fields {
		overrides, err := r.GetTypeOverrides(fields[i].ID)
		if err != nil {
			return nil, err
		}
		fields[i].TypeOverrides = overrides
	}
	return fields, nil
}

// SaveField upserts a single catalog field and its type overrides.
func (r *WorkspaceRepo) SaveField(f CatalogField) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		`INSERT INTO catalog_fields (id, table_id, name, type, nullable, primary_key, length, precision, scale, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   name=excluded.name, type=excluded.type, nullable=excluded.nullable,
		   primary_key=excluded.primary_key, length=excluded.length,
		   precision=excluded.precision, scale=excluded.scale, sort_order=excluded.sort_order`,
		f.ID, f.TableID, f.Name, f.Type,
		boolToInt(f.Nullable), boolToInt(f.PrimaryKey),
		f.Length, f.Precision, f.Scale, f.SortOrder,
	)
	if err != nil {
		return err
	}

	// Replace type overrides.
	if _, err := tx.Exec("DELETE FROM catalog_field_type_overrides WHERE field_id = ?", f.ID); err != nil {
		return err
	}
	for _, o := range f.TypeOverrides {
		if _, err := tx.Exec(
			"INSERT INTO catalog_field_type_overrides (field_id, dialect, type_override) VALUES (?, ?, ?)",
			f.ID, o.Dialect, o.TypeOverride,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DeleteField removes a catalog field by ID.
func (r *WorkspaceRepo) DeleteField(id string) error {
	_, err := r.db.Exec("DELETE FROM catalog_fields WHERE id = ?", id)
	return err
}

// ---------------------------------------------------------------------------
// Type Overrides
// ---------------------------------------------------------------------------

// GetTypeOverrides returns all type overrides for a field.
func (r *WorkspaceRepo) GetTypeOverrides(fieldID string) ([]CatalogFieldTypeOverride, error) {
	rows, err := r.db.Query(
		"SELECT field_id, dialect, type_override FROM catalog_field_type_overrides WHERE field_id = ?",
		fieldID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var overrides []CatalogFieldTypeOverride
	for rows.Next() {
		var o CatalogFieldTypeOverride
		if err := rows.Scan(&o.FieldID, &o.Dialect, &o.TypeOverride); err != nil {
			return nil, err
		}
		overrides = append(overrides, o)
	}
	return overrides, rows.Err()
}

// SetTypeOverride upserts a type override for a field and dialect.
func (r *WorkspaceRepo) SetTypeOverride(fieldID, dialect, typeOverride string) error {
	_, err := r.db.Exec(
		`INSERT INTO catalog_field_type_overrides (field_id, dialect, type_override)
		 VALUES (?, ?, ?)
		 ON CONFLICT(field_id, dialect) DO UPDATE SET type_override = excluded.type_override`,
		fieldID, dialect, typeOverride,
	)
	return err
}

// ---------------------------------------------------------------------------
// Catalog Relationships
// ---------------------------------------------------------------------------

// ListCatalogRelationships returns all catalog relationships with their field mappings.
func (r *WorkspaceRepo) ListCatalogRelationships() ([]CatalogRelationship, error) {
	rows, err := r.db.Query("SELECT id, source_table_id, target_table_id, name, note, cardinality FROM catalog_relationships")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rels []CatalogRelationship
	for rows.Next() {
		var rel CatalogRelationship
		var name, note, card sql.NullString
		if err := rows.Scan(&rel.ID, &rel.SourceTableID, &rel.TargetTableID, &name, &note, &card); err != nil {
			return nil, err
		}
		rel.Name = name.String
		rel.Note = note.String
		rel.Cardinality = card.String
		rels = append(rels, rel)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Load field mappings for each relationship.
	for i := range rels {
		fields, err := r.getRelationshipFields(rels[i].ID)
		if err != nil {
			return nil, err
		}
		rels[i].Fields = fields
	}
	return rels, nil
}

// SaveCatalogRelationship upserts a catalog relationship and its field mappings.
func (r *WorkspaceRepo) SaveCatalogRelationship(rel CatalogRelationship) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		`INSERT INTO catalog_relationships (id, source_table_id, target_table_id, name, note, cardinality)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   source_table_id=excluded.source_table_id, target_table_id=excluded.target_table_id,
		   name=excluded.name, note=excluded.note, cardinality=excluded.cardinality`,
		rel.ID, rel.SourceTableID, rel.TargetTableID,
		nullIfEmpty(rel.Name), nullIfEmpty(rel.Note), nullIfEmpty(rel.Cardinality),
	)
	if err != nil {
		return err
	}

	// Replace field mappings.
	if _, err := tx.Exec("DELETE FROM catalog_relationship_fields WHERE relationship_id = ?", rel.ID); err != nil {
		return err
	}
	for _, f := range rel.Fields {
		_, err := tx.Exec(
			"INSERT INTO catalog_relationship_fields (relationship_id, source_field_id, target_field_id, sort_order) VALUES (?, ?, ?, ?)",
			rel.ID, f.SourceFieldID, f.TargetFieldID, f.SortOrder,
		)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DeleteCatalogRelationship removes a catalog relationship by ID.
func (r *WorkspaceRepo) DeleteCatalogRelationship(id string) error {
	_, err := r.db.Exec("DELETE FROM catalog_relationships WHERE id = ?", id)
	return err
}

func (r *WorkspaceRepo) getRelationshipFields(relID string) ([]CatalogRelationshipField, error) {
	rows, err := r.db.Query(
		"SELECT relationship_id, source_field_id, target_field_id, sort_order FROM catalog_relationship_fields WHERE relationship_id = ? ORDER BY sort_order",
		relID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var fields []CatalogRelationshipField
	for rows.Next() {
		var f CatalogRelationshipField
		if err := rows.Scan(&f.RelationshipID, &f.SourceFieldID, &f.TargetFieldID, &f.SortOrder); err != nil {
			return nil, err
		}
		fields = append(fields, f)
	}
	return fields, rows.Err()
}

// ---------------------------------------------------------------------------
// Diagrams
// ---------------------------------------------------------------------------

// ListDiagrams returns lightweight summaries of all diagrams.
func (r *WorkspaceRepo) ListDiagrams() ([]DiagramSummary, error) {
	rows, err := r.db.Query("SELECT id, name FROM diagrams ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var diagrams []DiagramSummary
	for rows.Next() {
		var d DiagramSummary
		if err := rows.Scan(&d.ID, &d.Name); err != nil {
			return nil, err
		}
		diagrams = append(diagrams, d)
	}
	return diagrams, rows.Err()
}

// GetDiagram loads a full diagram including all placements, notes, and text blocks.
func (r *WorkspaceRepo) GetDiagram(id string) (*Diagram, error) {
	var d Diagram
	err := r.db.QueryRow(
		"SELECT id, name, version, viewport_zoom, viewport_pan_x, viewport_pan_y FROM diagrams WHERE id = ?", id,
	).Scan(&d.ID, &d.Name, &d.Version, &d.ViewportZoom, &d.ViewportPanX, &d.ViewportPanY)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// Table placements.
	if d.Tables, err = r.getDiagramTablePlacements(id); err != nil {
		return nil, err
	}
	// Relationship placements.
	if d.Relationships, err = r.getDiagramRelationshipPlacements(id); err != nil {
		return nil, err
	}
	// Notes.
	if d.Notes, err = r.getDiagramNotes(id); err != nil {
		return nil, err
	}
	// Text blocks.
	if d.TextBlocks, err = r.getDiagramTextBlocks(id); err != nil {
		return nil, err
	}
	return &d, nil
}

// SaveDiagram upserts a diagram and all its child elements.
func (r *WorkspaceRepo) SaveDiagram(d Diagram) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Upsert diagram header.
	_, err = tx.Exec(
		`INSERT INTO diagrams (id, name, version, viewport_zoom, viewport_pan_x, viewport_pan_y, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(id) DO UPDATE SET
		   name=excluded.name, version=excluded.version,
		   viewport_zoom=excluded.viewport_zoom, viewport_pan_x=excluded.viewport_pan_x,
		   viewport_pan_y=excluded.viewport_pan_y, updated_at=datetime('now')`,
		d.ID, d.Name, d.Version, d.ViewportZoom, d.ViewportPanX, d.ViewportPanY,
	)
	if err != nil {
		return fmt.Errorf("upsert diagram: %w", err)
	}

	// Replace table placements.
	if _, err := tx.Exec("DELETE FROM diagram_table_placements WHERE diagram_id = ?", d.ID); err != nil {
		return err
	}
	for _, tp := range d.Tables {
		_, err := tx.Exec(
			"INSERT INTO diagram_table_placements (id, diagram_id, catalog_table_id, x, y) VALUES (?, ?, ?, ?, ?)",
			tp.ID, d.ID, tp.CatalogTableID, tp.X, tp.Y,
		)
		if err != nil {
			return fmt.Errorf("insert table placement: %w", err)
		}
	}

	// Replace relationship placements.
	if _, err := tx.Exec("DELETE FROM diagram_relationship_placements WHERE diagram_id = ?", d.ID); err != nil {
		return err
	}
	for _, rp := range d.Relationships {
		_, err := tx.Exec(
			"INSERT INTO diagram_relationship_placements (id, diagram_id, catalog_relationship_id, label) VALUES (?, ?, ?, ?)",
			rp.ID, d.ID, rp.CatalogRelationshipID, nullIfEmpty(rp.Label),
		)
		if err != nil {
			return fmt.Errorf("insert relationship placement: %w", err)
		}
	}

	// Replace notes.
	if _, err := tx.Exec("DELETE FROM diagram_notes WHERE diagram_id = ?", d.ID); err != nil {
		return err
	}
	for _, n := range d.Notes {
		_, err := tx.Exec(
			"INSERT INTO diagram_notes (id, diagram_id, x, y, text, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)",
			n.ID, d.ID, n.X, n.Y, n.Text, n.Width, n.Height,
		)
		if err != nil {
			return fmt.Errorf("insert note: %w", err)
		}
	}

	// Replace text blocks.
	if _, err := tx.Exec("DELETE FROM diagram_text_blocks WHERE diagram_id = ?", d.ID); err != nil {
		return err
	}
	for _, tb := range d.TextBlocks {
		_, err := tx.Exec(
			`INSERT INTO diagram_text_blocks (id, diagram_id, x, y, text, width, height, font_size, use_markdown)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			tb.ID, d.ID, tb.X, tb.Y, tb.Text, tb.Width, tb.Height, tb.FontSize, boolToInt(tb.UseMarkdown),
		)
		if err != nil {
			return fmt.Errorf("insert text block: %w", err)
		}
	}

	return tx.Commit()
}

// DeleteDiagram removes a diagram and all its child elements (via CASCADE).
func (r *WorkspaceRepo) DeleteDiagram(id string) error {
	_, err := r.db.Exec("DELETE FROM diagrams WHERE id = ?", id)
	return err
}

func (r *WorkspaceRepo) getDiagramTablePlacements(diagramID string) ([]DiagramTablePlacement, error) {
	rows, err := r.db.Query(
		"SELECT id, diagram_id, catalog_table_id, x, y FROM diagram_table_placements WHERE diagram_id = ?",
		diagramID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var placements []DiagramTablePlacement
	for rows.Next() {
		var p DiagramTablePlacement
		if err := rows.Scan(&p.ID, &p.DiagramID, &p.CatalogTableID, &p.X, &p.Y); err != nil {
			return nil, err
		}
		placements = append(placements, p)
	}
	return placements, rows.Err()
}

func (r *WorkspaceRepo) getDiagramRelationshipPlacements(diagramID string) ([]DiagramRelationshipPlacement, error) {
	rows, err := r.db.Query(
		"SELECT id, diagram_id, catalog_relationship_id, label FROM diagram_relationship_placements WHERE diagram_id = ?",
		diagramID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var placements []DiagramRelationshipPlacement
	for rows.Next() {
		var p DiagramRelationshipPlacement
		var label sql.NullString
		if err := rows.Scan(&p.ID, &p.DiagramID, &p.CatalogRelationshipID, &label); err != nil {
			return nil, err
		}
		p.Label = label.String
		placements = append(placements, p)
	}
	return placements, rows.Err()
}

func (r *WorkspaceRepo) getDiagramNotes(diagramID string) ([]DiagramNote, error) {
	rows, err := r.db.Query(
		"SELECT id, diagram_id, x, y, text, width, height FROM diagram_notes WHERE diagram_id = ?",
		diagramID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []DiagramNote
	for rows.Next() {
		var n DiagramNote
		if err := rows.Scan(&n.ID, &n.DiagramID, &n.X, &n.Y, &n.Text, &n.Width, &n.Height); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, rows.Err()
}

func (r *WorkspaceRepo) getDiagramTextBlocks(diagramID string) ([]DiagramTextBlock, error) {
	rows, err := r.db.Query(
		"SELECT id, diagram_id, x, y, text, width, height, font_size, use_markdown FROM diagram_text_blocks WHERE diagram_id = ?",
		diagramID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []DiagramTextBlock
	for rows.Next() {
		var tb DiagramTextBlock
		var useMarkdown int
		if err := rows.Scan(&tb.ID, &tb.DiagramID, &tb.X, &tb.Y, &tb.Text, &tb.Width, &tb.Height, &tb.FontSize, &useMarkdown); err != nil {
			return nil, err
		}
		tb.UseMarkdown = useMarkdown != 0
		blocks = append(blocks, tb)
	}
	return blocks, rows.Err()
}

// ---------------------------------------------------------------------------
// Connection Profiles (workspace-scoped)
// ---------------------------------------------------------------------------

// ListConnectionProfiles returns all connection profiles in the workspace.
func (r *WorkspaceRepo) ListConnectionProfiles() ([]ConnectionProfile, error) {
	rows, err := r.db.Query(
		`SELECT id, name, driver, host, port, database_name, username, ssl_mode,
		        project, dataset, credentials_file, bigquery_auth_mode
		 FROM connection_profiles ORDER BY name`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var profiles []ConnectionProfile
	for rows.Next() {
		var p ConnectionProfile
		var host, dbName, username, sslMode, project, dataset, credFile, bqAuth sql.NullString
		var port sql.NullInt64
		if err := rows.Scan(
			&p.ID, &p.Name, &p.Driver,
			&host, &port, &dbName, &username, &sslMode,
			&project, &dataset, &credFile, &bqAuth,
		); err != nil {
			return nil, err
		}
		p.Host = host.String
		if port.Valid {
			portInt := int(port.Int64)
			p.Port = &portInt
		}
		p.DatabaseName = dbName.String
		p.Username = username.String
		p.SSLMode = sslMode.String
		p.Project = project.String
		p.Dataset = dataset.String
		p.CredentialsFile = credFile.String
		p.BigQueryAuthMode = bqAuth.String
		profiles = append(profiles, p)
	}
	return profiles, rows.Err()
}

// SaveConnectionProfile upserts a connection profile.
func (r *WorkspaceRepo) SaveConnectionProfile(p ConnectionProfile) error {
	_, err := r.db.Exec(
		`INSERT INTO connection_profiles (id, name, driver, host, port, database_name, username, ssl_mode,
		   project, dataset, credentials_file, bigquery_auth_mode, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(id) DO UPDATE SET
		   name=excluded.name, driver=excluded.driver, host=excluded.host, port=excluded.port,
		   database_name=excluded.database_name, username=excluded.username, ssl_mode=excluded.ssl_mode,
		   project=excluded.project, dataset=excluded.dataset, credentials_file=excluded.credentials_file,
		   bigquery_auth_mode=excluded.bigquery_auth_mode, updated_at=datetime('now')`,
		p.ID, p.Name, p.Driver,
		nullIfEmpty(p.Host), p.Port, nullIfEmpty(p.DatabaseName),
		nullIfEmpty(p.Username), nullIfEmpty(p.SSLMode),
		nullIfEmpty(p.Project), nullIfEmpty(p.Dataset),
		nullIfEmpty(p.CredentialsFile), nullIfEmpty(p.BigQueryAuthMode),
	)
	return err
}

// DeleteConnectionProfile removes a connection profile by ID.
func (r *WorkspaceRepo) DeleteConnectionProfile(id string) error {
	_, err := r.db.Exec("DELETE FROM connection_profiles WHERE id = ?", id)
	return err
}

// ---------------------------------------------------------------------------
// UI State
// ---------------------------------------------------------------------------

// GetUIState returns all UI state key-value pairs.
func (r *WorkspaceRepo) GetUIState() (UIState, error) {
	rows, err := r.db.Query("SELECT key, value FROM ui_state")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	state := make(UIState)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		state[k] = v
	}
	return state, rows.Err()
}

// SaveUIState replaces all UI state key-value pairs.
func (r *WorkspaceRepo) SaveUIState(state UIState) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM ui_state"); err != nil {
		return err
	}
	for k, v := range state {
		if _, err := tx.Exec("INSERT INTO ui_state (key, value) VALUES (?, ?)", k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
