# ERD Application Revision 2 – Implementation Plan

This plan implements the features described in **Application Revision 2** (docs/ERD Tool.md, lines 283–387): Projects, Landing Page, tabbed UI, menu bar, and target metadata.

---

## 1. Projects

### 1.1 Concept

- **Project** = container for a **table catalog** + a set of **diagrams** (subset of those tables).
- Stored in a **folder**: project config file, table catalog file, and diagram files.
- **Table catalog**: tables available to all diagrams in the project. Tables added via **New Table** (Edit → New Table or icon on Table Catalog bar).
- **Sync rule**: Table definitions on a diagram are copied into the diagram; edits to a table in any diagram sync back to the catalog and to all other project diagrams that use that table. Diagrams remain independently shareable (e.g. single `.diagram` file).
- **Project defaults**: Configurable defaults for BigQuery and Postgres export (e.g. project/dataset, schema prefix).

### 1.2 Data Model

- **Project (in-memory / on disk)**  
  - `name: string`  
  - `tableCatalog: Table[]` — table definitions without position (`x`/`y`); can use existing `Table` with optional position or a `CatalogTable` type.  
  - `diagramFilePaths: string[]` — paths relative to project root (e.g. `diagrams/erd1.diagram`).  
  - `exportDefaults?: { postgres?: { schema?: string }; bigquery?: { project?: string; dataset?: string } }` (optional).

- **Project folder layout**  
  - Project root: user-chosen directory.  
  - `project.json` in root: name, tableCatalog, diagramFilePaths, exportDefaults.  
  - Diagram files: e.g. `diagrams/*.diagram` or flat `*.diagram` in root (choose one convention).

- **Linking diagram tables to catalog**  
  - Tables added from catalog to a diagram get a stable **catalog table ID**. Edits to that table (in any diagram) update the catalog and propagate to every other project diagram that uses that table.

### 1.3 Implementation Tasks

| Task | Owner | Notes |
|------|--------|--------|
| Define `Project` and catalog types in Go and frontend (`types.ts`) | Backend + Frontend | No `x`/`y` in catalog tables. |
| Backend: ReadProject(path), WriteProject(path, data), ListDiagramFiles(path) | Go | Parse/write `project.json`; list diagram paths. |
| Backend: OpenDirectoryDialog (for Open/New Project) | Go | Wails runtime. |
| Backend: CreateProjectFolder or “New Project” flow (create dir + initial project.json) | Go | Optional helper. |
| Bridge: bind new Go APIs in bridge.ts | Frontend | openDirectoryDialog, readProject, writeProject, listDiagramFiles. |
| Project store: in-memory Project + projectRootPath; load/save project.json | Frontend | Separate from diagram store when project tab is active. |
| Sync: when a diagram table is linked to catalog (catalogTableId), persist edits to catalog and to other diagrams using that table | Frontend | Core project behavior. |

---

## 2. Landing Page

### 2.1 Spec

- App starts on a **landing page** (similar to VS Code Welcome).
- **Application title** at top.
- **Start**: New Diagram, Open Diagram, New Project, Open Project.
- **Recent**: Last 6 items; each entry indicates **Diagram** or **Project**.

### 2.2 Implementation Tasks

| Task | Owner | Notes |
|------|--------|--------|
| Show landing view when no documents are open | Frontend | Entry in app.ts; conditional render. |
| Layout: title, Start (4 actions), Recent (list) | Frontend | Match spec; optional reference image in docs. |
| New Diagram | Frontend | New untitled diagram tab; hide Welcome. |
| Open Diagram | Frontend | Existing Open File for `.diagram`; add diagram tab; hide Welcome. |
| New Project | Frontend + Backend | Create folder + initial project.json; open project tab; hide Welcome. |
| Open Project | Frontend + Backend | OpenDirectoryDialog → read project.json; open project tab; hide Welcome. |
| Recent: persist last 6 (path, kind: diagram \| project, label?, lastOpened) | Frontend | e.g. localStorage; update on open/save; sort by lastOpened. |
| Recent: click opens diagram or project by path | Frontend | Same as Open Diagram / Open Project. |
| When last tab is closed, show landing again | Frontend | Tab manager drives visibility. |

---

## 3. User Interface Changes

### 3.1 Shell

- **Welcome** or **blank area** when no documents are open.
- **Multiple documents**: diagrams and/or projects open in a **tabbed interface**.
- Each tab = one document (diagram or project). Close via **File menu** or **close icon** on tab.
- **Main content** depends on active tab: **Diagram UI** vs **Project UI**.

### 3.2 Diagram UI (Diagram tab active)

- Same as current app: main content = **diagram canvas** (tables, relationships, notes, canvas behavior).
- Reuse existing canvas, store, and diagram logic; only the container (tab content) and “current document” (from tab state) change.

### 3.3 Project UI (Project tab active)

- **Left sidebar** (collapsible) + **main content**.
- **Sidebar sections** (collapsible):
  - **Table Catalog**: List of tables in the project. Toolbar: **New Table**, **Import Tables**.
  - **Files**: List of diagrams in the project. Click diagram → open in content area (new tab in main area).
- **Content area**: Tabbed list of open diagrams *in this project*. Same canvas UI as Diagram UI; Save writes to diagram file under project root.

### 3.4 Implementation Tasks

| Task | Owner | Notes |
|------|--------|--------|
| Tab manager: list of open docs (id, type: diagram \| project, path, optional projectRoot, dirty) | Frontend | In app.ts or tabManager module. |
| Tab strip below menu bar: label, close icon, unsaved indicator | Frontend | One tab row for top-level docs. |
| On tab switch: persist current doc to in-memory state; load selected tab; re-render | Frontend | One store for “current” diagram or per-tab stores. |
| Close tab: File → Close Diagram/Close Project or tab close; prompt if dirty (Save/Discard/Cancel) | Frontend | On last tab close → show Welcome. |
| Project view: collapsible sidebar + content area | Frontend | New view when project tab is active. |
| Sidebar: Table Catalog (list + New Table, Import Tables) | Frontend | New Table → Table Editor → add to project catalog. Import → e.g. SQL into catalog. |
| Sidebar: Files (diagram list); click → open diagram in content area (inner tab) | Frontend | diagramFilePaths; inner tab strip for open diagrams in project. |
| Content area for project: inner tab strip; each tab = one diagram; load/save under project root | Frontend | Same canvas component as standalone diagram. |

---

## 4. Menus (Replace Top Button Bar)

### 4.1 Spec

- **File**: New Diagram, New Project, separator, Open Diagram, Open Project, separator, Save, Close Diagram, Close Project.
- **Edit**: Project Settings, separator, Undo, Redo, separator, New Table, separator, Theme (dark/light).
- **Tools**: Layout (submenu with layout options), Import…, Export….

### 4.2 Implementation Tasks

| Task | Owner | Notes |
|------|--------|--------|
| Remove current top button bar | Frontend | app.ts. |
| Add menu bar (File, Edit, Tools) with dropdowns | Frontend | Click menu → dropdown; click item → action. |
| File: wire New Diagram, New Project, Open Diagram, Open Project, Save, Close Diagram, Close Project | Frontend | Reuse or extend existing handlers. |
| Edit: Project Settings (when project tab active), Undo, Redo, New Table, Theme | Frontend | New Table: in project → catalog; in diagram → current behavior or “add from catalog”. |
| Tools: Layout (submenu), Import…, Export… | Frontend | Move existing Layout/Import/Export under Tools. |
| Enable/disable menu items by context (e.g. Close Project only when project tab active) | Frontend | Avoid invalid actions. |

---

## 5. Tables and Schema Information (Target Metadata)

### 5.1 Spec

- **Table editor**: allow target-specific metadata.
- **Table metadata**: Target (BigQuery, Postgres, etc), table prefix (e.g. BigQuery `project.dataset`), partitioning (TBD), schema prefix (Postgres).
- **Field metadata**: Similar target-specific options per field.
- **UX TBD**: e.g. “Edit Target Metadata” button → dialog for table; similar control per field.

### 5.2 Implementation Tasks

| Task | Owner | Notes |
|------|--------|--------|
| Extend data model: table-level target metadata (target, prefix, partitioning?, schema?) | Frontend + Backend | types.ts; project.json / diagram if needed. |
| Extend data model: field-level target metadata | Frontend + Backend | Optional per-field overrides. |
| Table editor: add “Edit Target Metadata” (or equivalent) opening a dialog | Frontend | Dialog fields: target, table prefix, partitioning, schema prefix. |
| Field editor: add target metadata control per field (if required) | Frontend | Same dialog pattern or inline. |
| Export (BigQuery/Postgres) use table/field target metadata when present | Backend | Use prefix/schema from metadata. |

*This section can be implemented after the core project/landing/tabs/menus work.*

---

## 6. Implementation Order (Suggested)

1. **Backend**: OpenDirectoryDialog, ReadProject, WriteProject, ListDiagramFiles; project.json schema in Go; optional CreateProjectFolder.
2. **Frontend types**: Project, RecentEntry; catalog table type (Table without x/y or CatalogTable).
3. **Bridge**: New bindings for directory dialog, read/write project, list diagram files.
4. **Landing page**: View when no docs open; Start (4 actions) and Recent (localStorage, last 6); wire actions to “add tab” and open file/folder.
5. **Tab strip**: Tab bar, tab list, current tab, switch/close (with dirty prompt); show Welcome when last tab closed.
6. **Menu bar**: Replace toolbar with File / Edit / Tools; connect to existing handlers; add Close and project-related items.
7. **Diagram tab content**: Render existing canvas + store inside active diagram tab; on switch, save to tab state and load selected tab.
8. **Project tab content**: Sidebar (Table Catalog + Files), content area with inner diagram tabs; New Table and Import Tables into catalog; open/save diagrams under project root.
9. **Catalog–diagram link and sync**: When a diagram table is linked to catalog (catalogTableId), edits update catalog and all other project diagrams using that table.
10. **Recent list**: Update on open/save; persist; trim to 6; sort by lastOpened.
11. **Project defaults**: Project Settings dialog (name, export defaults); persist in project.json (can follow after core project UI).
12. **Target metadata**: Table/field metadata model, “Edit Target Metadata” UX, and export integration (after main revision 2 scope).

---

## 7. Files to Add or Change (Summary)

| Area | Files |
|------|--------|
| Backend | `internal/app/app.go` – OpenDirectoryDialog, ReadProject, WriteProject, ListDiagramFiles; project struct. |
| Bridge | `frontend/src/bridge.ts` – openDirectoryDialog, readProject, writeProject, listDiagramFiles. |
| Types | `frontend/src/types.ts` – Project, RecentEntry; optional CatalogTable or Table without position. |
| App shell | `frontend/src/app.ts` – Landing view, tab strip, menu bar, diagram vs project view; init shows Welcome or main app. |
| Optional modules | `welcomeView.ts`, `menuBar.ts`, `projectView.ts`, `tabManager.ts` to keep app.ts manageable. |
| Styles | `frontend/src/styles.css` – menu bar, tabs, landing layout, project sidebar. |

---

## 8. Out of Scope / Later

- **Project Settings** and **export defaults** UI: can be a follow-up after project CRUD and sidebar work.
- **Target metadata** UX (“Edit Target Metadata” and field-level): explicitly deferred until UX is decided; data model and export hooks can be stubbed.
- **Layout/Import/Export**: Behavior unchanged; only moved under Tools menu.

This plan keeps the existing diagram and export behavior working inside the new shell (projects, landing, tabs, menus) and adds catalog sync and target metadata as specified in the referenced document section.
