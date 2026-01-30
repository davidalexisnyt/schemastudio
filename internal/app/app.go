package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"schemastudio/internal/importers"
	"schemastudio/internal/schema"
	"schemastudio/internal/sqlx"
)

// App is the Wails-bound application for file I/O and export/import.
type App struct {
	ctx context.Context
}

// NewApp returns a new App. Call Startup with the Wails context before using dialogs.
func NewApp() *App {
	return &App{}
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

// ImportSQL parses DDL and returns diagram JSON.
func (a *App) ImportSQL(sqlContent string) (string, error) {
	d, err := importers.ParseSQL(sqlContent)
	if err != nil {
		return "", err
	}
	return d.MarshalJSONString()
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
