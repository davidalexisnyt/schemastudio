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

export type Selection =
  | { type: "table"; tableId: string }
  | { type: "field"; tableId: string; fieldId: string }
  | { type: "relationship"; relationshipId: string }
  | null;

export const FIELD_TYPES = [
  "text",
  "int",
  "bigint",
  "numeric",
  "uuid",
  "timestamp",
  "date",
  "boolean",
  "other",
] as const;
