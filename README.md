# Schema Studio

A cross-platform (Linux, Windows, macOS) desktop app for drawing **entity-relationship diagrams**. Think of it as a whiteboard for your database schema - tables, fields, and the foreign key relationshipss between them.

Schema Studio is build with a Go backend and a web-style frontend, thanks to [Wails](https://wails.io). Wails can be thought of as Electron, but with Go. The heavy application logic is built in Go, with all the efficiency, speed, and conurrency benefits of the language, while the front-end is rendered using standard web technologies in the Webview component that ships with all contemporary operating systems.

If you just want to draw ERDs and get SQL DDL, PNG, or Mermaid diagrams out the other end, this is the application for that.

## Why Another Diagramming Tool

Back in the 1990's through the early 2000's, there were many great commercial, freeware, and open source database design tools available for database architects to do their jobs. However, many of these tools seemed to have fell faded away since Agile ate the world and proper up-front design became evil. Yes, we can create ERDs in Figma or Miro or Diagrams.io or in Markdown using Mermaid.js. But there's a fundamental difference between a tool designed for a specific purpose (cordless drill/driver) and a generic tool that you can maybe do the job with lots of extra effort (pocket multitool).

I have tried many generalist diagramming tools to create ERDs. All were frustrating to use and produced sub-par output.

I have tried the diagramming features in database IDEs like DBeaver and SQL Server Management Studio, but these produce ugly diagrams that are tied to a specific database platform and store the diagrams in the databases you're attempting to diagram. Therefore, these tools are only useful for "as-built" diagrams and not design (since changing tables in the diagram physically alters the tables in the database).

What I wanted was a tool that can do the following:

- Create both "as-built" diagrams from an existing database as well as up-front design of a new or updated database schema.
- Generate beautiful images that can be use in documentation and for communicating with stakeholders.
- Generate the DDL required to create a schema in various target DBMSs (currently, PostgeSQL and BigQuery)
- Maintain a catalog of tables that can be used on different diagrams.
- Import a catalog of tables from SQL DDL files or CSV files.
- Support annotations on diagrams.
- Maintain logical designs tagged with specifics for different target DBMSs. e.g. Logical type "string" for a "name" field would get generated as varchar(50) for Postgres and string for BigQuery.

These are features that existing in high-end database design tools like ERWin back in the day, but seem to be missing from contemporary tools.

## What’s in the box

- **Tables** — Add them, drag them around, add/edit/remove fields. Relationships are drawn by connecting one field to another (Connect mode).
- **Canvas** — Pan by dragging, zoom with Ctrl+scroll.
- **Layout** — Auto-arrange with Grid, Hierarchical, or Force layout.
- **Import** — Bring in JSON, SQL (PostgreSQL-style), Mermaid ERD, or CSV.
- **Export** — Send your diagram out as JSON, SQL (PostgreSQL or BigQuery), Mermaid, PNG, or SVG.

So you can sketch a schema, tweak it visually, then turn it into DDL or diagrams without leaving the app.

## What you need

- **Go** 1.21+ (highly recommended to always use the latest version of Go)
- **Node.js** 18+ (for building the frontend)
- **Wails v2 CLI** (for dev and native builds):

  ```bash
  go install github.com/wailsapp/wails/v2/cmd/wails@latest
  ```

## Run it

**Development** (with hot-reload on the frontend):

```bash
wails dev
```

**Build and run the app yourself:**

```bash
cd frontend && npm install && npm run build && cd ..
go build .
```

Then run the binary (e.g. `./schemastudio` or `schemastudio.exe` on Windows).

**Fancy installers / distributable:**

```bash
wails build
```

That spits out a native binary and (depending on platform) installers in `build/bin/`.

## Project layout (the short version)

- `main.go` — Wails entry, embeds the built frontend.
- `internal/app` — File I/O, save/load/export/import and the stuff the frontend calls.
- `internal/schema` — Diagram, tables, fields, relationships; JSON/Mermaid helpers.
- `internal/sqlx` — SQL export (PostgreSQL, BigQuery).
- `internal/importers` — Parsers for SQL, Mermaid, CSV into the shared diagram format.
- `frontend/` — TypeScript + Vite: UI, canvas, store, and the bridge to Go.

## Tests

- **Go:** `go test ./...`
- **Frontend:** `cd frontend && npm run test`

---
