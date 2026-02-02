export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Field {
  id: string;
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
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

export interface Diagram {
  version: number;
  tables: Table[];
  relationships: Relationship[];
  notes?: Note[];
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
  "text",
  "string",
  "int",
  "bigint",
  "numeric",
  "uuid",
  "timestamp",
  "date",
  "boolean",
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
  /** When true, save diagrams automatically. */
  autoSaveDiagrams?: boolean;
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
