# ERD Tool

A desktop Entity Relationship Diagram editor built with **Wails** (Go backend + web frontend). Design database schemas visually, export to PostgreSQL or BigQuery DDL, Mermaid, JSON, PNG, or SVG.

## Requirements

- Go 1.21+
- Node.js 18+ (for frontend build)
- [Wails v2 CLI](https://wails.io/docs/next/gettingstarted/installation) (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

## Build

1. Build the frontend:

   ```bash
   cd frontend && npm install && npm run build && cd ..
   ```

2. Build the app:

   ```bash
   go build .
   ```

   Or use Wails to build a native binary with installers:

   ```bash
   wails build
   ```

## Run

- **Development** (hot-reload frontend):

  ```bash
  wails dev
  ```

  Requires the Wails CLI and will start the Go app with the frontend dev server.

- **Production**: run the binary produced by `go build` or `wails build`:
  ```bash
   ./erd
  ```
  On Windows: `erd.exe`

## Features

- **Tables**: Add table, drag to reposition, add/edit/delete fields, delete table.
- **Relationships**: Click "Connect", then click a source field and a target field to create a relationship. Click a relationship line to select; right-click for Delete.
- **Pan/Zoom**: Drag the canvas to pan; Ctrl+wheel to zoom.
- **Layout**: Layout > Grid / Hierarchical / Force to auto-arrange tables.
- **Save/Load**: Save and load diagram as JSON (file dialog via Wails).
- **Import**: JSON, SQL (PostgreSQL-style DDL), or Mermaid ERD.
- **Export**: JSON, SQL (PostgreSQL or BigQuery), Mermaid, PNG, SVG.

## Project structure

- `main.go` – Wails entry point, embeds frontend.
- `internal/app` – Wails-bound app: file I/O, Save/Load/Export/Import dialogs and backend logic.
- `internal/schema` – Diagram, Table, Field, Relationship, Viewport; JSON and Mermaid helpers.
- `internal/sqlx` – SQL export registry; PostgreSQL and BigQuery exporters.
- `internal/importers` – SQL and Mermaid parsers producing the shared diagram format.
- `frontend/` – TypeScript + Vite; store, canvas, toolbar, bridge to Go.

## Tests

- Go: `go test ./...`
- Frontend: `cd frontend && npm run test`
