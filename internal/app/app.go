package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"schemastudio/internal/dbconn"
	"schemastudio/internal/importers"
	"schemastudio/internal/schema"
	"schemastudio/internal/sqlx"
)

// App is the Wails-bound application for file I/O and export/import.
type App struct {
	ctx     context.Context
	version string
}

// NewApp returns a new App. version is the application version (e.g. "0.2.0").
// Call Startup with the Wails context before using dialogs.
func NewApp(version string) *App {
	return &App{version: version}
}

// Version returns the application version.
func (a *App) Version() string {
	return a.version
}

// Startup is called by Wails when the app starts; store context for dialogs.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

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
