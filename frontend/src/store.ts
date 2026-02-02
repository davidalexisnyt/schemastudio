import type {
  Diagram,
  Table,
  Field,
  Relationship,
  Note,
  Viewport,
} from "./types";
import { getTableWidth } from "./canvas";
import { runForceDirectedLayout } from "./layout";

const MAX_UNDO = 50;

function nextId(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 11);
}

export function createEmptyDiagram(): Diagram {
  return {
    version: 1,
    tables: [],
    relationships: [],
    notes: [],
    viewport: undefined,
  };
}

export class Store {
  private diagram: Diagram;
  private undoStack: Diagram[] = [];
  private redoStack: Diagram[] = [];
  private listeners: Set<() => void> = new Set();
  private dirty = false;

  constructor(initial?: Diagram) {
    this.diagram = initial
      ? JSON.parse(JSON.stringify(initial))
      : createEmptyDiagram();
    if (!this.diagram.notes) this.diagram.notes = [];
  }

  getDiagram(): Diagram {
    return this.diagram;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  private pushUndo(): void {
    this.undoStack.push(JSON.parse(JSON.stringify(this.diagram)));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  clearDirty(): void {
    this.dirty = false;
    this.notify();
  }

  setDiagram(d: Diagram): void {
    this.pushUndo();
    const copy = JSON.parse(JSON.stringify(d)) as Diagram;
    if (!copy.notes) copy.notes = [];
    copy.tables.forEach((t) => {
      t.fields.forEach((f) => {
        f.type = f.type?.toLowerCase() ?? "text";
      });
    });
    this.diagram = copy;
    this.notify();
  }

  undo(): boolean {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(JSON.parse(JSON.stringify(this.diagram)));
    const prev = this.undoStack.pop()!;
    this.diagram = prev;
    this.notify();
    return true;
  }

  redo(): boolean {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(JSON.parse(JSON.stringify(this.diagram)));
    const next = this.redoStack.pop()!;
    this.diagram = next;
    this.notify();
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  addTable(x: number, y: number): Table {
    this.pushUndo();
    const t: Table = {
      id: nextId("t"),
      name: "Table" + (this.diagram.tables.length + 1),
      x,
      y,
      fields: [{ id: nextId("f"), name: "id", type: "int" }],
    };
    this.diagram.tables.push(t);
    this.notify();
    return t;
  }

  addTableWithContent(
    x: number,
    y: number,
    name: string,
    fields: { name: string; type: string; nullable?: boolean; primaryKey?: boolean }[],
    catalogTableId?: string
  ): Table {
    this.pushUndo();
    const t: Table = {
      id: nextId("t"),
      name,
      x,
      y,
      fields: fields.map((f) => ({
        id: nextId("f"),
        name: f.name,
        type: (f.type || "text").toLowerCase(),
        nullable: f.nullable ?? false,
        primaryKey: f.primaryKey ?? false,
      })),
    };
    if (catalogTableId) t.catalogTableId = catalogTableId;
    this.diagram.tables.push(t);
    this.notify();
    return t;
  }

  updateTablePosition(tableId: string, x: number, y: number): void {
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) return;
    t.x = x;
    t.y = y;
    this.dirty = true;
    this.notify();
  }

  setTableCatalogId(tableId: string, catalogTableId: string | null): void {
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) return;
    if (catalogTableId) {
      t.catalogTableId = catalogTableId;
    } else {
      delete t.catalogTableId;
    }
    this.dirty = true;
    this.notify();
  }

  updateTableName(tableId: string, name: string): void {
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) return;
    t.name = name;
    this.notify();
  }

  replaceTableContent(
    tableId: string,
    name: string,
    fields: {
      id?: string;
      name: string;
      type: string;
      nullable?: boolean;
      primaryKey?: boolean;
    }[],
  ): void {
    this.pushUndo();
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) return;
    t.name = name;
    const existingIds = new Set(t.fields.map((f) => f.id));
    const newFields: Field[] = [];
    for (const row of fields) {
      const typeNorm = row.type.trim().toLowerCase() || "text";
      if (row.id && existingIds.has(row.id)) {
        const f = t.fields.find((x) => x.id === row.id)!;
        f.name = row.name;
        f.type = typeNorm;
        f.nullable = row.nullable ?? false;
        f.primaryKey = row.primaryKey ?? false;
        newFields.push(f);
      } else {
        newFields.push({
          id: row.id ?? nextId("f"),
          name: row.name,
          type: typeNorm,
          nullable: row.nullable ?? false,
          primaryKey: row.primaryKey ?? false,
        });
      }
    }
    const keptIds = new Set(newFields.map((f) => f.id));
    this.diagram.relationships = this.diagram.relationships.filter(
      (r) =>
        !(r.sourceTableId === tableId && !keptIds.has(r.sourceFieldId)) &&
        !(r.targetTableId === tableId && !keptIds.has(r.targetFieldId)),
    );
    t.fields = newFields;
    this.notify();
  }

  deleteTable(tableId: string): void {
    this.pushUndo();
    this.diagram.tables = this.diagram.tables.filter((t) => t.id !== tableId);
    this.diagram.relationships = this.diagram.relationships.filter(
      (r) => r.sourceTableId !== tableId && r.targetTableId !== tableId,
    );
    this.notify();
  }

  addField(
    tableId: string,
    name?: string,
    type?: string,
    nullable?: boolean,
    primaryKey?: boolean,
  ): Field {
    this.pushUndo();
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) throw new Error("Table not found");
    const f: Field = {
      id: nextId("f"),
      name: name ?? "field",
      type: (type ?? "text").toLowerCase(),
      nullable: nullable ?? false,
      primaryKey: primaryKey ?? false,
    };
    t.fields.push(f);
    this.notify();
    return f;
  }

  reorderFields(tableId: string, fromIndex: number, toIndex: number): void {
    this.pushUndo();
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (
      !t ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= t.fields.length ||
      toIndex >= t.fields.length
    )
      return;
    const [removed] = t.fields.splice(fromIndex, 1);
    t.fields.splice(toIndex, 0, removed);
    this.notify();
  }

  updateField(
    tableId: string,
    fieldId: string,
    name: string,
    type: string,
    nullable?: boolean,
    primaryKey?: boolean,
  ): void {
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) return;
    const f = t.fields.find((x) => x.id === fieldId);
    if (!f) return;
    f.name = name;
    f.type = type.toLowerCase();
    if (nullable !== undefined) f.nullable = nullable;
    if (primaryKey !== undefined) f.primaryKey = primaryKey;
    this.notify();
  }

  deleteField(tableId: string, fieldId: string): void {
    this.pushUndo();
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) return;
    t.fields = t.fields.filter((f) => f.id !== fieldId);
    this.diagram.relationships = this.diagram.relationships.filter(
      (r) =>
        !(r.sourceTableId === tableId && r.sourceFieldId === fieldId) &&
        !(r.targetTableId === tableId && r.targetFieldId === fieldId),
    );
    this.notify();
  }

  addRelationship(
    sourceTableId: string,
    sourceFieldId: string,
    targetTableId: string,
    targetFieldId: string,
  ): Relationship {
    this.pushUndo();
    const r: Relationship = {
      id: nextId("r"),
      sourceTableId,
      sourceFieldId,
      targetTableId,
      targetFieldId,
    };
    this.diagram.relationships.push(r);
    this.notify();
    return r;
  }

  addRelationshipWithMeta(
    sourceTableId: string,
    sourceFieldIds: string[],
    targetTableId: string,
    targetFieldIds: string[],
    name?: string,
    note?: string,
    cardinality?: string,
  ): Relationship {
    this.pushUndo();
    const r: Relationship = {
      id: nextId("r"),
      sourceTableId,
      sourceFieldId: sourceFieldIds[0] ?? "",
      targetTableId,
      targetFieldId: targetFieldIds[0] ?? "",
      sourceFieldIds,
      targetFieldIds,
      name: name ?? "",
      note: note ?? "",
      cardinality: cardinality ?? "",
    };
    this.diagram.relationships.push(r);
    this.notify();
    return r;
  }

  updateRelationshipLabel(relationshipId: string, label: string): void {
    const r = this.diagram.relationships.find((x) => x.id === relationshipId);
    if (!r) return;
    r.label = label;
    this.notify();
  }

  updateRelationshipMeta(
    relationshipId: string,
    sourceFieldIds: string[],
    targetFieldIds: string[],
    name?: string,
    note?: string,
    cardinality?: string,
  ): void {
    this.pushUndo();
    const r = this.diagram.relationships.find((x) => x.id === relationshipId);
    if (!r) return;
    r.sourceFieldIds = sourceFieldIds;
    r.targetFieldIds = targetFieldIds;
    r.sourceFieldId = sourceFieldIds[0] ?? r.sourceFieldId;
    r.targetFieldId = targetFieldIds[0] ?? r.targetFieldId;
    r.name = name ?? "";
    r.note = note ?? "";
    r.cardinality = cardinality ?? "";
    this.notify();
  }

  deleteRelationship(relationshipId: string): void {
    this.pushUndo();
    this.diagram.relationships = this.diagram.relationships.filter(
      (r) => r.id !== relationshipId,
    );
    this.notify();
  }

  setViewport(v: Viewport): void {
    this.diagram.viewport = v;
    this.notify();
  }

  addNote(x: number, y: number, text: string): Note {
    this.pushUndo();
    const n: Note = {
      id: nextId("n"),
      x,
      y,
      text: text ?? "",
    };
    if (!this.diagram.notes) this.diagram.notes = [];
    this.diagram.notes.push(n);
    this.notify();
    return n;
  }

  updateNote(noteId: string, text: string): void {
    const n = this.diagram.notes?.find((x) => x.id === noteId);
    if (!n) return;
    this.pushUndo();
    n.text = text;
    this.notify();
  }

  updateNotePosition(noteId: string, x: number, y: number): void {
    const n = this.diagram.notes?.find((x) => x.id === noteId);
    if (!n) return;
    n.x = x;
    n.y = y;
    this.dirty = true;
    this.notify();
  }

  updateNoteSize(noteId: string, width: number, height: number): void {
    const n = this.diagram.notes?.find((x) => x.id === noteId);
    if (!n) return;
    n.width = width;
    n.height = height;
    this.dirty = true;
    this.notify();
  }

  deleteNote(noteId: string): void {
    this.pushUndo();
    if (!this.diagram.notes) return;
    this.diagram.notes = this.diagram.notes.filter((n) => n.id !== noteId);
    this.notify();
  }

  applyLayout(layout: "grid" | "hierarchical" | "force"): void {
    this.pushUndo();
    const tables = this.diagram.tables;
    const relationships = this.diagram.relationships ?? [];

    if (layout === "force") {
      const positions = runForceDirectedLayout(tables, relationships);
      for (const t of tables) {
        const pos = positions.get(t.id);
        if (pos) {
          t.x = pos.x;
          t.y = pos.y;
        }
      }
      this.notify();
      return;
    }

    const HEADER_HEIGHT = 28;
    const ROW_HEIGHT = 22;
    const MIN_LAYOUT_GAP = 48;
    const tableHeight = (t: Table) =>
      HEADER_HEIGHT + t.fields.length * ROW_HEIGHT;

    const cols =
      layout === "grid" ? Math.ceil(Math.sqrt(tables.length)) || 1 : 3;
    const rowCount = Math.ceil(tables.length / cols) || 1;
    const rowHeights: number[] = [];
    for (let r = 0; r < rowCount; r++) {
      const start = r * cols;
      const end = Math.min(start + cols, tables.length);
      const maxH =
        end > start
          ? Math.max(...tables.slice(start, end).map((t) => tableHeight(t)))
          : HEADER_HEIGHT + ROW_HEIGHT;
      rowHeights.push(maxH + MIN_LAYOUT_GAP);
    }
    let y = 0;
    for (let r = 0; r < rowCount; r++) {
      let x = 0;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i >= tables.length) break;
        tables[i].x = x;
        tables[i].y = y;
        x += getTableWidth(tables[i]) + MIN_LAYOUT_GAP;
      }
      y += rowHeights[r];
    }
    this.notify();
  }
}
