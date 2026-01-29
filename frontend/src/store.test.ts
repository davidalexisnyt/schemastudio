import { describe, it, expect } from "vitest";
import { Store, createEmptyDiagram } from "./store";

describe("Store", () => {
  it("creates empty diagram", () => {
    const store = new Store();
    const d = store.getDiagram();
    expect(d.version).toBe(1);
    expect(d.tables).toHaveLength(0);
    expect(d.relationships).toHaveLength(0);
  });

  it("adds table", () => {
    const store = new Store();
    const t = store.addTable(100, 200);
    expect(t.name).toMatch(/^Table\d+$/);
    expect(t.x).toBe(100);
    expect(t.y).toBe(200);
    expect(t.fields).toHaveLength(1);
    const d = store.getDiagram();
    expect(d.tables).toHaveLength(1);
  });

  it("adds field", () => {
    const store = new Store();
    store.addTable(0, 0);
    const tableId = store.getDiagram().tables[0].id;
    const f = store.addField(tableId);
    expect(f.name).toBe("field");
    expect(store.getDiagram().tables[0].fields).toHaveLength(2);
  });

  it("undo/redo", () => {
    const store = new Store();
    store.addTable(0, 0);
    expect(store.getDiagram().tables).toHaveLength(1);
    store.undo();
    expect(store.getDiagram().tables).toHaveLength(0);
    store.redo();
    expect(store.getDiagram().tables).toHaveLength(1);
  });

  it("setDiagram replaces state", () => {
    const store = new Store();
    store.addTable(0, 0);
    const empty = createEmptyDiagram();
    store.setDiagram(empty);
    expect(store.getDiagram().tables).toHaveLength(0);
  });
});
