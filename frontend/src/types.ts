export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Field {
  id: string;
  name: string;
  type: string;
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
  "many-to-1",
  "many-to-many",
  "0/1-to-0/1",
  "0/1-to-many",
  "many-to-0/many",
] as const;

export interface Diagram {
  version: number;
  tables: Table[];
  relationships: Relationship[];
  viewport?: Viewport;
}

export type Selection =
  | { type: "table"; tableId: string }
  | { type: "field"; tableId: string; fieldId: string }
  | { type: "relationship"; relationshipId: string }
  | null;

export const FIELD_TYPES = [
  "TEXT",
  "INT",
  "BIGINT",
  "NUMERIC",
  "UUID",
  "TIMESTAMP",
  "DATE",
  "BOOLEAN",
  "OTHER",
] as const;
