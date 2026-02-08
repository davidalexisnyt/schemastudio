package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"schemastudio/internal/dbconn"
	"schemastudio/internal/importers"
	"schemastudio/internal/schema"
	"schemastudio/internal/sqlx"
	"schemastudio/internal/workspace"
)

// App is the Wails-bound application for file I/O, workspace management, and export/import.
type App struct {
	ctx     context.Context
	version string
	wm      *workspace.WorkspaceManager
}

// NewApp returns a new App. version is the application version (e.g. "0.4.0").
// Call Startup with the Wails context before using dialogs.
func NewApp(version string) *App {
	return &App{
		version: version,
		wm:      workspace.NewManager(),
	}
}

// Version returns the application version.
func (a *App) Version() string {
	return a.version
}

// Startup is called by Wails when the app starts; store context for dialogs.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

// Shutdown is called by Wails when the app is closing; close all open workspaces.
func (a *App) Shutdown(ctx context.Context) {
	a.wm.CloseAll()
}

// ---------------------------------------------------------------------------
// Workspace lifecycle
// ---------------------------------------------------------------------------

// createWorkspaceResult is the JSON envelope returned by CreateWorkspace / OpenWorkspace.
type createWorkspaceResult struct {
	WorkspaceID string                     `json:"workspaceId"`
	FilePath    string                     `json:"filePath"`
	Settings    workspace.WorkspaceSettings `json:"settings"`
}

// CreateWorkspace creates a new .schemastudio file, initializes the schema, and
// returns JSON with the workspace ID, file path, and default settings.
func (a *App) CreateWorkspace(filePath string) (string, error) {
	wsID, repo, err := a.wm.CreateWorkspace(filePath)
	if err != nil {
		return "", fmt.Errorf("create workspace: %w", err)
	}
	settings, err := repo.GetAllSettings()
	if err != nil {
		return "", err
	}
	return marshalJSON(createWorkspaceResult{
		WorkspaceID: wsID,
		FilePath:    filePath,
		Settings:    settings,
	})
}

// openWorkspaceResult is the JSON envelope returned by OpenWorkspace.
type openWorkspaceResult struct {
	WorkspaceID          string                           `json:"workspaceId"`
	FilePath             string                           `json:"filePath"`
	Settings             workspace.WorkspaceSettings       `json:"settings"`
	CatalogTables        []workspace.CatalogTable          `json:"catalogTables"`
	CatalogRelationships []workspace.CatalogRelationship   `json:"catalogRelationships"`
	Diagrams             []workspace.DiagramSummary        `json:"diagrams"`
	UIState              workspace.UIState                 `json:"uiState"`
}

// OpenWorkspace opens an existing .schemastudio file and returns JSON with the
// full workspace state (settings, catalog, diagrams list, UI state).
func (a *App) OpenWorkspace(filePath string) (string, error) {
	wsID, repo, err := a.wm.OpenWorkspace(filePath)
	if err != nil {
		return "", fmt.Errorf("open workspace: %w", err)
	}

	settings, err := repo.GetAllSettings()
	if err != nil {
		return "", err
	}
	tables, err := repo.ListCatalogTables()
	if err != nil {
		return "", err
	}
	if tables == nil {
		tables = []workspace.CatalogTable{}
	}
	rels, err := repo.ListCatalogRelationships()
	if err != nil {
		return "", err
	}
	if rels == nil {
		rels = []workspace.CatalogRelationship{}
	}
	diagrams, err := repo.ListDiagrams()
	if err != nil {
		return "", err
	}
	if diagrams == nil {
		diagrams = []workspace.DiagramSummary{}
	}
	uiState, err := repo.GetUIState()
	if err != nil {
		return "", err
	}
	if uiState == nil {
		uiState = workspace.UIState{}
	}

	return marshalJSON(openWorkspaceResult{
		WorkspaceID:          wsID,
		FilePath:             filePath,
		Settings:             settings,
		CatalogTables:        tables,
		CatalogRelationships: rels,
		Diagrams:             diagrams,
		UIState:              uiState,
	})
}

// CloseWorkspace closes the SQLite connection for a workspace.
func (a *App) CloseWorkspace(wsID string) error {
	return a.wm.CloseWorkspace(wsID)
}

// ---------------------------------------------------------------------------
// Workspace Settings
// ---------------------------------------------------------------------------

// GetWorkspaceSettings returns workspace settings as JSON.
func (a *App) GetWorkspaceSettings(wsID string) (string, error) {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return "", fmt.Errorf("workspace %s not open", wsID)
	}
	settings, err := repo.GetAllSettings()
	if err != nil {
		return "", err
	}
	return marshalJSON(settings)
}

// SaveWorkspaceSetting saves a single workspace setting.
func (a *App) SaveWorkspaceSetting(wsID string, key string, value string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	return repo.SetSetting(key, value)
}

// SaveWorkspaceSettings saves all workspace settings from JSON.
func (a *App) SaveWorkspaceSettings(wsID string, settingsJSON string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	var s workspace.WorkspaceSettings
	if err := json.Unmarshal([]byte(settingsJSON), &s); err != nil {
		return err
	}
	return repo.SaveAllSettings(s)
}

// ---------------------------------------------------------------------------
// Catalog Tables
// ---------------------------------------------------------------------------

// GetCatalogTables returns all catalog tables as JSON.
func (a *App) GetCatalogTables(wsID string) (string, error) {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return "", fmt.Errorf("workspace %s not open", wsID)
	}
	tables, err := repo.ListCatalogTables()
	if err != nil {
		return "", err
	}
	if tables == nil {
		tables = []workspace.CatalogTable{}
	}
	return marshalJSON(tables)
}

// SaveCatalogTable upserts a catalog table (with fields and type overrides) from JSON.
func (a *App) SaveCatalogTable(wsID string, tableJSON string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	var t workspace.CatalogTable
	if err := json.Unmarshal([]byte(tableJSON), &t); err != nil {
		return err
	}
	return repo.SaveCatalogTable(t)
}

// DeleteCatalogTable removes a catalog table by ID.
func (a *App) DeleteCatalogTable(wsID string, tableID string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	return repo.DeleteCatalogTable(tableID)
}

// ---------------------------------------------------------------------------
// Catalog Fields
// ---------------------------------------------------------------------------

// SaveCatalogField upserts a single catalog field (with type overrides) from JSON.
func (a *App) SaveCatalogField(wsID string, fieldJSON string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	var f workspace.CatalogField
	if err := json.Unmarshal([]byte(fieldJSON), &f); err != nil {
		return err
	}
	return repo.SaveField(f)
}

// DeleteCatalogField removes a catalog field by ID.
func (a *App) DeleteCatalogField(wsID string, fieldID string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	return repo.DeleteField(fieldID)
}

// ---------------------------------------------------------------------------
// Catalog Relationships
// ---------------------------------------------------------------------------

// GetCatalogRelationships returns all catalog relationships as JSON.
func (a *App) GetCatalogRelationships(wsID string) (string, error) {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return "", fmt.Errorf("workspace %s not open", wsID)
	}
	rels, err := repo.ListCatalogRelationships()
	if err != nil {
		return "", err
	}
	if rels == nil {
		rels = []workspace.CatalogRelationship{}
	}
	return marshalJSON(rels)
}

// SaveCatalogRelationship upserts a catalog relationship from JSON.
func (a *App) SaveCatalogRelationship(wsID string, relJSON string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	var rel workspace.CatalogRelationship
	if err := json.Unmarshal([]byte(relJSON), &rel); err != nil {
		return err
	}
	return repo.SaveCatalogRelationship(rel)
}

// DeleteCatalogRelationship removes a catalog relationship by ID.
func (a *App) DeleteCatalogRelationship(wsID string, relID string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	return repo.DeleteCatalogRelationship(relID)
}

// ---------------------------------------------------------------------------
// Diagrams
// ---------------------------------------------------------------------------

// ListDiagrams returns lightweight diagram summaries as JSON.
func (a *App) ListWorkspaceDiagrams(wsID string) (string, error) {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return "", fmt.Errorf("workspace %s not open", wsID)
	}
	diagrams, err := repo.ListDiagrams()
	if err != nil {
		return "", err
	}
	if diagrams == nil {
		diagrams = []workspace.DiagramSummary{}
	}
	return marshalJSON(diagrams)
}

// GetDiagram returns a full diagram (with placements, notes, text blocks) as JSON.
func (a *App) GetDiagram(wsID string, diagramID string) (string, error) {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return "", fmt.Errorf("workspace %s not open", wsID)
	}
	d, err := repo.GetDiagram(diagramID)
	if err != nil {
		return "", err
	}
	if d == nil {
		return "", fmt.Errorf("diagram %s not found", diagramID)
	}
	return marshalJSON(d)
}

// SaveDiagram upserts a diagram (with all child elements) from JSON.
func (a *App) SaveDiagram(wsID string, diagramJSON string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	var d workspace.Diagram
	if err := json.Unmarshal([]byte(diagramJSON), &d); err != nil {
		return err
	}
	return repo.SaveDiagram(d)
}

// DeleteDiagram removes a diagram by ID.
func (a *App) DeleteDiagram(wsID string, diagramID string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	return repo.DeleteDiagram(diagramID)
}

// ---------------------------------------------------------------------------
// UI State
// ---------------------------------------------------------------------------

// GetUIState returns the workspace UI state as JSON.
func (a *App) GetUIState(wsID string) (string, error) {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return "", fmt.Errorf("workspace %s not open", wsID)
	}
	state, err := repo.GetUIState()
	if err != nil {
		return "", err
	}
	if state == nil {
		state = workspace.UIState{}
	}
	return marshalJSON(state)
}

// SaveUIState saves the workspace UI state from JSON.
func (a *App) SaveUIState(wsID string, stateJSON string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	var state workspace.UIState
	if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
		return err
	}
	return repo.SaveUIState(state)
}

// ---------------------------------------------------------------------------
// Workspace Connection Profiles
// ---------------------------------------------------------------------------

// GetWorkspaceConnectionProfiles returns workspace-scoped connection profiles as JSON.
func (a *App) GetWorkspaceConnectionProfiles(wsID string) (string, error) {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return "", fmt.Errorf("workspace %s not open", wsID)
	}
	profiles, err := repo.ListConnectionProfiles()
	if err != nil {
		return "", err
	}
	if profiles == nil {
		profiles = []workspace.ConnectionProfile{}
	}
	return marshalJSON(profiles)
}

// SaveWorkspaceConnectionProfile upserts a workspace-scoped connection profile from JSON.
func (a *App) SaveWorkspaceConnectionProfile(wsID string, profileJSON string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	var p workspace.ConnectionProfile
	if err := json.Unmarshal([]byte(profileJSON), &p); err != nil {
		return err
	}
	return repo.SaveConnectionProfile(p)
}

// DeleteWorkspaceConnectionProfile removes a workspace-scoped connection profile by ID.
func (a *App) DeleteWorkspaceConnectionProfile(wsID string, profileID string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	return repo.DeleteConnectionProfile(profileID)
}

// ImportGlobalProfile copies a global connection profile into the workspace.
func (a *App) ImportGlobalProfile(wsID string, globalProfileName string) error {
	repo := a.wm.GetRepo(wsID)
	if repo == nil {
		return fmt.Errorf("workspace %s not open", wsID)
	}
	// Load the global profile JSON.
	dir, err := connectionProfilesDir()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(dir, globalProfileName+".json"))
	if err != nil {
		return fmt.Errorf("load global profile: %w", err)
	}
	var p workspace.ConnectionProfile
	if err := json.Unmarshal(data, &p); err != nil {
		return fmt.Errorf("parse global profile: %w", err)
	}
	// Ensure it has a unique ID in the workspace context.
	if p.ID == "" {
		p.ID = globalProfileName
	}
	p.Name = globalProfileName
	return repo.SaveConnectionProfile(p)
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

// MigrateWorkspace reads a legacy file-based workspace at oldRootPath and
// writes it into a new .schemastudio SQLite database at newFilePath.
// Returns JSON with migration results (tables/diagrams imported, warnings, errors).
func (a *App) MigrateWorkspace(oldRootPath string, newFilePath string) (string, error) {
	result, err := workspace.MigrateFromFolder(oldRootPath, newFilePath)
	if err != nil {
		return "", fmt.Errorf("migration failed: %w", err)
	}
	return marshalJSON(result)
}

// ---------------------------------------------------------------------------
// Legacy file I/O (kept for backward compatibility during migration)
// ---------------------------------------------------------------------------

// Save writes the diagram JSON to the given path.
func (a *App) Save(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// SaveBase64 decodes base64 data and writes it to the given path (e.g. for PNG export).
func (a *App) SaveBase64(path string, base64Data string) error {
	decoded, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return err
	}
	return os.WriteFile(path, decoded, 0644)
}

// Load reads the diagram JSON from the given path.
func (a *App) Load(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// Remove deletes the file at the given path (e.g. for rename: save to new path then remove old).
func (a *App) Remove(path string) error {
	return os.Remove(path)
}

// SaveFileDialog opens a save file dialog and returns the chosen path, or empty string if cancelled.
func (a *App) SaveFileDialog(title string, defaultFilename string, filterName string, filterPattern string) (string, error) {
	opts := runtime.SaveDialogOptions{
		Title:            title,
		DefaultFilename:  defaultFilename,
		DefaultDirectory: "",
		Filters: []runtime.FileFilter{
			{DisplayName: filterName, Pattern: filterPattern},
		},
	}
	return runtime.SaveFileDialog(a.ctx, opts)
}

// OpenFileDialog opens a file dialog and returns the chosen path, or empty string if cancelled.
func (a *App) OpenFileDialog(title string, filterName string, filterPattern string) (string, error) {
	opts := runtime.OpenDialogOptions{
		Title:            title,
		DefaultDirectory: "",
		Filters: []runtime.FileFilter{
			{DisplayName: filterName, Pattern: filterPattern},
		},
	}
	return runtime.OpenFileDialog(a.ctx, opts)
}

// OpenDirectoryDialog opens a directory dialog and returns the chosen path, or empty string if cancelled.
func (a *App) OpenDirectoryDialog(title string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
	})
}

// ListFiles returns file names in rootPath matching pattern (e.g. "*.diagram"), relative to rootPath.
func (a *App) ListFiles(rootPath string, pattern string) ([]string, error) {
	matches, err := filepath.Glob(filepath.Join(rootPath, pattern))
	if err != nil {
		return nil, err
	}
	var out []string
	for _, m := range matches {
		info, err := os.Stat(m)
		if err != nil || info.IsDir() {
			continue
		}
		out = append(out, filepath.Base(m))
	}
	sort.Strings(out)
	return out, nil
}

// ExportSQL returns DDL for the given dialect ("postgres" or "bigquery") from the diagram JSON.
func (a *App) ExportSQL(dialect string, jsonContent string) (string, error) {
	var d schema.Diagram
	if err := json.Unmarshal([]byte(jsonContent), &d); err != nil {
		return "", err
	}
	return sqlx.Export(dialect, d)
}

// ExportBigQuery returns BigQuery DDL with fully qualified table names (project.dataset.table).
// creationMode is "if_not_exists", "create_or_replace", or "".
func (a *App) ExportBigQuery(jsonContent string, project string, dataset string, creationMode string) (string, error) {
	var d schema.Diagram
	if err := json.Unmarshal([]byte(jsonContent), &d); err != nil {
		return "", err
	}
	return sqlx.ExportBigQueryWithTarget(d, project, dataset, creationMode)
}

// ExportPostgres returns PostgreSQL DDL. If schemaName is non-empty, table names are schema-qualified (e.g. "myschema"."mytable").
func (a *App) ExportPostgres(jsonContent string, schemaName string) (string, error) {
	var d schema.Diagram
	if err := json.Unmarshal([]byte(jsonContent), &d); err != nil {
		return "", err
	}
	return sqlx.ExportPostgres(d, schemaName)
}

// ImportSQL parses DDL and returns TableCatalog JSON (importSource set to the given name).
func (a *App) ImportSQL(sqlContent string, importSource string) (string, error) {
	catalog, err := importers.ParseSQL(sqlContent)
	if err != nil {
		return "", err
	}
	catalog.ImportSource = importSource
	b, err := json.Marshal(catalog)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ImportCSV parses CSV (schema, table, column, type, is_nullable, field_order) and returns TableCatalog JSON.
func (a *App) ImportCSV(csvContent string, importSource string) (string, error) {
	catalog, err := importers.ParseCSV(csvContent)
	if err != nil {
		return "", err
	}
	catalog.ImportSource = importSource
	b, err := json.Marshal(catalog)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ImportMermaid parses Mermaid ERD and returns diagram JSON.
func (a *App) ImportMermaid(mermaidContent string) (string, error) {
	d, err := importers.ParseMermaid(mermaidContent)
	if err != nil {
		return "", err
	}
	return d.MarshalJSONString()
}

// ExportMermaid returns Mermaid ERD syntax from the diagram JSON.
func (a *App) ExportMermaid(jsonContent string) (string, error) {
	var d schema.Diagram
	if err := json.Unmarshal([]byte(jsonContent), &d); err != nil {
		return "", err
	}
	return schema.ToMermaid(d), nil
}

// ExportPlantUML returns PlantUML class diagram syntax from the diagram JSON.
func (a *App) ExportPlantUML(jsonContent string) (string, error) {
	var d schema.Diagram
	if err := json.Unmarshal([]byte(jsonContent), &d); err != nil {
		return "", err
	}
	return schema.ToPlantUML(d), nil
}

// --- Database connectivity methods ---

// TestDatabaseConnection validates connectivity to a database and returns a status message.
func (a *App) TestDatabaseConnection(configJSON string) (string, error) {
	var cfg dbconn.ConnectionConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return "", err
	}
	inspector, err := dbconn.NewInspector(cfg.Driver)
	if err != nil {
		return "", err
	}
	if err := inspector.Connect(cfg); err != nil {
		return "", err
	}
	defer inspector.Close()
	return "Connection successful", nil
}

// ListDatabaseSchemas returns a JSON array of schema names for the given connection.
func (a *App) ListDatabaseSchemas(configJSON string) (string, error) {
	var cfg dbconn.ConnectionConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return "", err
	}
	inspector, err := dbconn.NewInspector(cfg.Driver)
	if err != nil {
		return "", err
	}
	if err := inspector.Connect(cfg); err != nil {
		return "", err
	}
	defer inspector.Close()
	schemas, err := inspector.ListSchemas()
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(schemas)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ListDatabaseTables returns a JSON array of table names in the given schema.
func (a *App) ListDatabaseTables(configJSON string, schemaName string) (string, error) {
	var cfg dbconn.ConnectionConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return "", err
	}
	inspector, err := dbconn.NewInspector(cfg.Driver)
	if err != nil {
		return "", err
	}
	if err := inspector.Connect(cfg); err != nil {
		return "", err
	}
	defer inspector.Close()
	tables, err := inspector.ListTables(schemaName)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(tables)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ImportFromDatabase introspects selected tables and returns TableCatalog JSON.
func (a *App) ImportFromDatabase(configJSON string, schemaName string, tablesJSON string) (string, error) {
	var cfg dbconn.ConnectionConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return "", err
	}
	var tableNames []string
	if tablesJSON != "" {
		if err := json.Unmarshal([]byte(tablesJSON), &tableNames); err != nil {
			return "", err
		}
	}
	inspector, err := dbconn.NewInspector(cfg.Driver)
	if err != nil {
		return "", err
	}
	if err := inspector.Connect(cfg); err != nil {
		return "", err
	}
	defer inspector.Close()
	catalog, err := inspector.InspectSchema(schemaName, tableNames)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(catalog)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// SaveOAuthClientConfig saves the OAuth client ID and secret for BigQuery user auth.
func (a *App) SaveOAuthClientConfig(clientID string, clientSecret string) error {
	return dbconn.SaveOAuthClientConfig(dbconn.OAuthClientConfig{
		ClientID:     clientID,
		ClientSecret: clientSecret,
	})
}

// LoadOAuthClientConfig returns the saved OAuth client ID and secret as JSON.
func (a *App) LoadOAuthClientConfig() (string, error) {
	cfg, err := dbconn.LoadOAuthClientConfig()
	if err != nil {
		return "{}", nil // Return empty JSON if no config exists
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// --- Connection Profiles ---

// SaveConnectionProfile saves a connection profile (without password) to disk.
func (a *App) SaveConnectionProfile(name string, configJSON string) error {
	dir, err := connectionProfilesDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, name+".json")
	return os.WriteFile(path, []byte(configJSON), 0600)
}

// LoadConnectionProfile loads a saved connection profile.
func (a *App) LoadConnectionProfile(name string) (string, error) {
	dir, err := connectionProfilesDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, name+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ListConnectionProfiles returns a JSON array of saved connection profile names.
func (a *App) ListConnectionProfiles() (string, error) {
	dir, err := connectionProfilesDir()
	if err != nil {
		return "[]", nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "[]", nil
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			name := e.Name()
			names = append(names, name[:len(name)-5])
		}
	}
	sort.Strings(names)
	b, err := json.Marshal(names)
	if err != nil {
		return "[]", nil
	}
	return string(b), nil
}

// DeleteConnectionProfile deletes a saved connection profile.
func (a *App) DeleteConnectionProfile(name string) error {
	dir, err := connectionProfilesDir()
	if err != nil {
		return err
	}
	path := filepath.Join(dir, name+".json")
	return os.Remove(path)
}

// --- Keyring (OS credential manager) for passwords ---

// SaveProfilePassword stores a connection profile's password in the OS credential manager.
func (a *App) SaveProfilePassword(profileName string, password string) error {
	return dbconn.SavePassword(profileName, password)
}

// LoadProfilePassword retrieves a connection profile's password from the OS credential manager.
func (a *App) LoadProfilePassword(profileName string) (string, error) {
	return dbconn.LoadPassword(profileName)
}

// DeleteProfilePassword removes a connection profile's password from the OS credential manager.
func (a *App) DeleteProfilePassword(profileName string) error {
	return dbconn.DeletePassword(profileName)
}

func connectionProfilesDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".schemastudio", "connections")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

// marshalJSON is a helper that marshals v to a JSON string.
func marshalJSON(v interface{}) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
