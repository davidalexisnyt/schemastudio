import type { Diagram, Table, Field, Relationship, Viewport } from "./types";

const MAX_UNDO = 50;

function nextId(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 11);
}

export function createEmptyDiagram(): Diagram {
  return {
    version: 1,
    tables: [],
    relationships: [],
    viewport: undefined,
  };
}

export class Store {
  private diagram: Diagram;
  private undoStack: Diagram[] = [];
  private redoStack: Diagram[] = [];
  private listeners: Set<() => void> = new Set();

  constructor(initial?: Diagram) {
    this.diagram = initial
      ? JSON.parse(JSON.stringify(initial))
      : createEmptyDiagram();
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
  }

  setDiagram(d: Diagram): void {
    this.pushUndo();
    this.diagram = JSON.parse(JSON.stringify(d));
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
      fields: [{ id: nextId("f"), name: "id", type: "INT" }],
    };
    this.diagram.tables.push(t);
    this.notify();
    return t;
  }

  updateTablePosition(tableId: string, x: number, y: number): void {
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) return;
    t.x = x;
    t.y = y;
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
    fields: { id?: string; name: string; type: string }[],
  ): void {
    this.pushUndo();
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) return;
    t.name = name;
    const existingIds = new Set(t.fields.map((f) => f.id));
    const newFields: Field[] = [];
    for (const row of fields) {
      if (row.id && existingIds.has(row.id)) {
        const f = t.fields.find((x) => x.id === row.id)!;
        f.name = row.name;
        f.type = row.type;
        newFields.push(f);
      } else {
        newFields.push({
          id: row.id ?? nextId("f"),
          name: row.name,
          type: row.type,
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

  addField(tableId: string, name?: string, type?: string): Field {
    this.pushUndo();
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) throw new Error("Table not found");
    const f: Field = {
      id: nextId("f"),
      name: name ?? "field",
      type: type ?? "TEXT",
    };
    t.fields.push(f);
    this.notify();
    return f;
  }

  updateField(
    tableId: string,
    fieldId: string,
    name: string,
    type: string,
  ): void {
    const t = this.diagram.tables.find((x) => x.id === tableId);
    if (!t) return;
    const f = t.fields.find((x) => x.id === fieldId);
    if (!f) return;
    f.name = name;
    f.type = type;
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

  applyLayout(layout: "grid" | "hierarchical" | "force"): void {
    this.pushUndo();
    const tables = this.diagram.tables;
    const TABLE_WIDTH = 200;
    const HEADER_HEIGHT = 28;
    const ROW_HEIGHT = 22;
    const MIN_LAYOUT_GAP = 48;
    const stepX = TABLE_WIDTH + MIN_LAYOUT_GAP;
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
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i >= tables.length) break;
        tables[i].x = c * stepX;
        tables[i].y = y;
      }
      y += rowHeights[r];
    }
    this.notify();
  }
}
