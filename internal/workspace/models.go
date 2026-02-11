package workspace

// WorkspaceSettings holds workspace-level configuration as key-value pairs.
type WorkspaceSettings struct {
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	NotationStyle string `json:"notationStyle,omitempty"`
}

// CatalogTable is a table in the workspace table catalog.
type CatalogTable struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	SortOrder int            `json:"sortOrder"`
	Fields    []CatalogField `json:"fields"`
}

// CatalogField is a column definition within a catalog table.
type CatalogField struct {
	ID            string                    `json:"id"`
	TableID       string                    `json:"tableId"`
	Name          string                    `json:"name"`
	Type          string                    `json:"type"`
	Nullable      bool                      `json:"nullable,omitempty"`
	PrimaryKey    bool                      `json:"primaryKey,omitempty"`
	Length        *int                      `json:"length,omitempty"`
	Precision     *int                      `json:"precision,omitempty"`
	Scale         *int                      `json:"scale,omitempty"`
	SortOrder     int                       `json:"sortOrder"`
	TypeOverrides []CatalogFieldTypeOverride `json:"typeOverrides,omitempty"`
}

// CatalogFieldTypeOverride holds a per-dialect type override for a field.
type CatalogFieldTypeOverride struct {
	FieldID      string `json:"fieldId"`
	Dialect      string `json:"dialect"`
	TypeOverride string `json:"typeOverride"`
}

// CatalogRelationship represents a foreign-key relationship between catalog tables.
type CatalogRelationship struct {
	ID            string                       `json:"id"`
	SourceTableID string                       `json:"sourceTableId"`
	TargetTableID string                       `json:"targetTableId"`
	Name          string                       `json:"name,omitempty"`
	Note          string                       `json:"note,omitempty"`
	Cardinality   string                       `json:"cardinality,omitempty"`
	Fields        []CatalogRelationshipField   `json:"fields,omitempty"`
}

// CatalogRelationshipField maps a source field to a target field within a relationship.
type CatalogRelationshipField struct {
	RelationshipID string `json:"relationshipId"`
	SourceFieldID  string `json:"sourceFieldId"`
	TargetFieldID  string `json:"targetFieldId"`
	SortOrder      int    `json:"sortOrder"`
}

// Diagram represents a diagram within the workspace.
type Diagram struct {
	ID           string                        `json:"id"`
	Name         string                        `json:"name"`
	Version      int                           `json:"version"`
	ViewportZoom float64                       `json:"viewportZoom"`
	ViewportPanX float64                       `json:"viewportPanX"`
	ViewportPanY float64                       `json:"viewportPanY"`
	Tables       []DiagramTablePlacement       `json:"tables,omitempty"`
	Relationships []DiagramRelationshipPlacement `json:"relationships,omitempty"`
	Notes        []DiagramNote                 `json:"notes,omitempty"`
	TextBlocks   []DiagramTextBlock            `json:"textBlocks,omitempty"`
}

// DiagramTablePlacement positions a catalog table on a diagram.
type DiagramTablePlacement struct {
	ID             string  `json:"id"`
	DiagramID      string  `json:"diagramId"`
	CatalogTableID string  `json:"catalogTableId"`
	X              float64 `json:"x"`
	Y              float64 `json:"y"`
}

// DiagramRelationshipPlacement places a catalog relationship on a diagram.
type DiagramRelationshipPlacement struct {
	ID                    string `json:"id"`
	DiagramID             string `json:"diagramId"`
	CatalogRelationshipID string `json:"catalogRelationshipId"`
	Label                 string `json:"label,omitempty"`
}

// DiagramNote is a sticky note on a diagram.
type DiagramNote struct {
	ID        string   `json:"id"`
	DiagramID string   `json:"diagramId"`
	X         float64  `json:"x"`
	Y         float64  `json:"y"`
	Text      string   `json:"text"`
	Width     *float64 `json:"width,omitempty"`
	Height    *float64 `json:"height,omitempty"`
}

// DiagramTextBlock is a text block on a diagram.
type DiagramTextBlock struct {
	ID          string   `json:"id"`
	DiagramID   string   `json:"diagramId"`
	X           float64  `json:"x"`
	Y           float64  `json:"y"`
	Text        string   `json:"text"`
	Width       *float64 `json:"width,omitempty"`
	Height      *float64 `json:"height,omitempty"`
	FontSize    *float64 `json:"fontSize,omitempty"`
	UseMarkdown bool     `json:"useMarkdown,omitempty"`
}

// ConnectionProfile stores database connection details within a workspace.
type ConnectionProfile struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Driver           string `json:"driver"`
	Host             string `json:"host,omitempty"`
	Port             *int   `json:"port,omitempty"`
	DatabaseName     string `json:"databaseName,omitempty"`
	Username         string `json:"username,omitempty"`
	SSLMode          string `json:"sslMode,omitempty"`
	Project          string `json:"project,omitempty"`
	Dataset          string `json:"dataset,omitempty"`
	CredentialsFile  string `json:"credentialsFile,omitempty"`
	BigQueryAuthMode string `json:"bigqueryAuthMode,omitempty"`
}

// UIState holds persisted UI state as key-value pairs.
type UIState map[string]string

// DiagramSummary is a lightweight listing of diagrams (no child data).
type DiagramSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
