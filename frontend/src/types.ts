export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

/** Per-database type override for a field. */
export interface FieldTypeOverride {
  type: string; // e.g. "varchar(15)", "nvarchar(max)", "STRING"
}

export interface Field {
  id: string;
  name: string;
  type: string; // generic model type from FIELD_TYPES
  nullable?: boolean;
  primaryKey?: boolean;
  length?: number; // for string types (e.g. 15 -> varchar(15) on export)
  precision?: number; // for numeric types (e.g. 10)
  scale?: number; // for numeric types (e.g. 2)
  /** Per-database type overrides. Key = dialect ("postgres", "mysql", "mssql", "bigquery"). */
  typeOverrides?: Record<string, FieldTypeOverride>;
}

export interface Table {
  id: string;
  name: string;
  x: number;
  y: number;
  fields: Field[];
  /** When set, this table is an instance of the catalog entry with this id; edits sync to catalog and other diagrams. */
  catalogTableId?: string;
}

export interface Relationship {
  id: string;
  sourceTableId: string;
  sourceFieldId: string;
  targetTableId: string;
  targetFieldId: string;
  label?: string;
  sourceFieldIds?: string[];
  targetFieldIds?: string[];
  name?: string;
  note?: string;
  cardinality?: string;
  /** When set, this diagram relationship is synced with this catalog relationship. */
  catalogRelationshipId?: string;
}

/** Relationship stored in the workspace catalog (between catalog tables, identified by field names). */
export interface CatalogRelationship {
  id: string;
  sourceCatalogTableId: string;
  targetCatalogTableId: string;
  sourceFieldName: string;
  targetFieldName: string;
}

// ---------------------------------------------------------------------------
// New workspace / SQLite-backed types
// ---------------------------------------------------------------------------

/** Catalog relationship field mapping (for composite foreign keys). */
export interface CatalogRelationshipField {
  relationshipId: string;
  sourceFieldId: string;
  targetFieldId: string;
  sortOrder: number;
}

/** New-style catalog relationship stored in SQLite. */
export interface WsCatalogRelationship {
  id: string;
  sourceTableId: string;
  targetTableId: string;
  name?: string;
  note?: string;
  cardinality?: string;
  fields?: CatalogRelationshipField[];
}

/** Diagram table placement (positions a catalog table on a diagram). */
export interface DiagramTablePlacement {
  id: string;
  diagramId: string;
  catalogTableId: string;
  x: number;
  y: number;
}

/** Diagram relationship placement. */
export interface DiagramRelationshipPlacement {
  id: string;
  diagramId: string;
  catalogRelationshipId: string;
  label?: string;
}

/** Diagram note (SQLite-backed). */
export interface DiagramNote {
  id: string;
  diagramId: string;
  x: number;
  y: number;
  text: string;
  width?: number;
  height?: number;
}

/** Diagram text block (SQLite-backed). */
export interface DiagramTextBlock {
  id: string;
  diagramId: string;
  x: number;
  y: number;
  text: string;
  width?: number;
  height?: number;
  fontSize?: number;
  useMarkdown?: boolean;
}

/** Full diagram as stored in SQLite. */
export interface WsDiagram {
  id: string;
  name: string;
  version: number;
  viewportZoom: number;
  viewportPanX: number;
  viewportPanY: number;
  tables?: DiagramTablePlacement[];
  relationships?: DiagramRelationshipPlacement[];
  notes?: DiagramNote[];
  textBlocks?: DiagramTextBlock[];
}

/** Lightweight diagram listing (no child data). */
export interface DiagramSummary {
  id: string;
  name: string;
}

/** Workspace settings as stored in SQLite. */
export interface WsSettings {
  name: string;
  description?: string;
  notationStyle?: string;
}

/** Catalog field with type overrides, as stored in SQLite. */
export interface WsCatalogField {
  id: string;
  tableId: string;
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  length?: number;
  precision?: number;
  scale?: number;
  sortOrder: number;
  typeOverrides?: WsCatalogFieldTypeOverride[];
}

/** Per-dialect type override for a catalog field. */
export interface WsCatalogFieldTypeOverride {
  fieldId: string;
  dialect: string;
  typeOverride: string;
}

/** Catalog table with fields, as stored in SQLite. */
export interface WsCatalogTable {
  id: string;
  name: string;
  sortOrder: number;
  fields: WsCatalogField[];
}

/** Workspace connection profile (stored in SQLite). */
export interface WsConnectionProfile {
  id: string;
  name: string;
  driver: string;
  host?: string;
  port?: number;
  databaseName?: string;
  username?: string;
  sslMode?: string;
  project?: string;
  dataset?: string;
  credentialsFile?: string;
  bigqueryAuthMode?: string;
}

/** Result returned by CreateWorkspace. */
export interface CreateWorkspaceResult {
  workspaceId: string;
  filePath: string;
  settings: WsSettings;
}

/** Result returned by OpenWorkspace. */
export interface OpenWorkspaceResult {
  workspaceId: string;
  filePath: string;
  settings: WsSettings;
  catalogTables: WsCatalogTable[];
  catalogRelationships: WsCatalogRelationship[];
  diagrams: DiagramSummary[];
  uiState: Record<string, string>;
}

export const CARDINALITY_OPTIONS = [
  "1-to-1",
  "1-to-many",
  "1-to-0/many",
  "many-to-1",
  "many-to-many",
  "0/1-to-0/1",
  "0/1-to-many",
  "many-to-0/many",
] as const;

export interface Note {
  id: string;
  x: number;
  y: number;
  text: string;
  width?: number;
  height?: number;
}

export interface TextBlock {
  id: string;
  x: number;
  y: number;
  text: string;
  width?: number;
  height?: number;
  fontSize?: number;
  useMarkdown?: boolean;
}

export interface Diagram {
  version: number;
  tables: Table[];
  relationships: Relationship[];
  notes?: Note[];
  textBlocks?: TextBlock[];
  viewport?: Viewport;
}

/** Result of an import (SQL, CSV, etc.). Used to populate workspace catalog or a diagram. */
export interface TableCatalog {
  importSource: string;
  tables: Table[];
  relationships: Relationship[];
}

export type Selection =
  | { type: "table"; tableId: string }
  | { type: "field"; tableId: string; fieldId: string }
  | { type: "relationship"; relationshipId: string }
  | null;

export const FIELD_TYPES = [
  "string",
  "integer",
  "float",
  "numeric",
  "boolean",
  "date",
  "time",
  "timestamp",
  "timestamptz",
  "uuid",
  "json",
  "bytes",
  "other",
] as const;

/** Recent entry for landing page (workspace or diagram). */
export interface RecentEntry {
  path: string;
  kind: "workspace" | "diagram";
  label?: string;
  lastOpened: number;
}

/** Workspace config (workspace.config.json). */
export interface WorkspaceConfig {
  name: string;
  description?: string;
}

/** Table in catalog (id is the stable catalog id; compatible with Table). */
export interface CatalogTable {
  id: string;
  name: string;
  x?: number;
  y?: number;
  fields: Field[];
}

/** Workspace state (in-memory). */
export interface WorkspaceState {
  rootPath: string;
  name: string;
  description?: string;
  catalogTables: CatalogTable[];
}

/** Persisted UI state for workspace sidebar (workspace.state file). */
export interface WorkspaceUIState {
  catalogOpen?: boolean;
  diagramsOpen?: boolean;
  settingsOpen?: boolean;
  sidebarScrollTop?: number;
  /** Scroll position inside the Table Catalog accordion content. */
  catalogContentScrollTop?: number;
  /** Scroll position inside the Diagrams accordion content. */
  diagramsContentScrollTop?: number;
}
