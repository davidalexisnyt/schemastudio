import type { Diagram, Table, Field, Relationship, Selection } from "./types";
import { Store } from "./store";
import {
  getRelationshipPath,
  getFieldAnchor,
  TABLE_WIDTH,
  ROW_HEIGHT,
  HEADER_HEIGHT,
} from "./canvas";
import * as bridge from "./bridge";

let store: Store;
let selection: Selection = null;
let pan = { x: 0, y: 0 };
let zoom = 1;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let dragTableId: string | null = null;
let dragStart = { x: 0, y: 0 };
let connectMode = false;
let connectSource: { tableId: string; fieldId: string } | null = null;
let connectLine: { x: number; y: number } | null = null;
let container: HTMLElement;
let svg: SVGElement;
let transformGroup: SVGGElement;
let tablesLayer: SVGGElement;
let relationshipsLayer: SVGGElement;
let tempLine: SVGPathElement | null = null;

function emitSelection(): void {
  container.dispatchEvent(
    new CustomEvent("erd-selection", { detail: selection }),
  );
}

function setSelection(s: Selection): void {
  selection = s;
  emitSelection();
  render();
}

function showToast(message: string): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function screenToDiagram(sx: number, sy: number): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  const x = (sx - r.left - pan.x) / zoom;
  const y = (sy - r.top - pan.y) / zoom;
  return { x, y };
}

function render(): void {
  const d = store.getDiagram();
  tablesLayer.innerHTML = "";
  relationshipsLayer.innerHTML = "";

  d.relationships.forEach((r) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", getRelationshipPath(d, r));
    path.setAttribute(
      "class",
      "relationship-path" +
        (selection?.type === "relationship" && selection.relationshipId === r.id
          ? " selected"
          : ""),
    );
    path.dataset.relationshipId = r.id;
    path.addEventListener("click", (e) => {
      e.stopPropagation();
      setSelection({ type: "relationship", relationshipId: r.id });
    });
    relationshipsLayer.appendChild(path);
  });

  d.tables.forEach((t) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute(
      "class",
      "table-group" +
        (selection?.type === "table" && selection.tableId === t.id
          ? " selected"
          : ""),
    );
    g.setAttribute("transform", `translate(${t.x}, ${t.y})`);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const h = HEADER_HEIGHT + t.fields.length * ROW_HEIGHT;
    rect.setAttribute("width", String(TABLE_WIDTH));
    rect.setAttribute("height", String(h));
    rect.setAttribute("class", "table-rect");
    rect.setAttribute("rx", "6");
    g.appendChild(rect);

    const header = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    header.setAttribute("x", "10");
    header.setAttribute("y", HEADER_HEIGHT - 8);
    header.setAttribute("class", "table-header");
    header.textContent = t.name;
    g.appendChild(header);

    t.fields.forEach((f, i) => {
      const row = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      row.setAttribute("x", "10");
      row.setAttribute("y", HEADER_HEIGHT + (i + 1) * ROW_HEIGHT - 6);
      row.setAttribute(
        "class",
        "table-field" +
          (selection?.type === "field" &&
          selection.tableId === t.id &&
          selection.fieldId === f.id
            ? " selected"
            : ""),
      );
      row.textContent = `${f.name}: ${f.type}`;
      row.dataset.tableId = t.id;
      row.dataset.fieldId = f.id;
      row.style.cursor = "pointer";
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (connectMode && connectSource) {
          if (
            connectSource.tableId !== t.id ||
            connectSource.fieldId !== f.id
          ) {
            store.addRelationship(
              connectSource.tableId,
              connectSource.fieldId,
              t.id,
              f.id,
            );
            connectSource = null;
            if (tempLine) tempLine.remove();
            tempLine = null;
          }
          return;
        }
        if (connectMode && !connectSource) {
          connectSource = { tableId: t.id, fieldId: f.id };
          tempLine = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
          );
          tempLine.setAttribute("class", "relationship-path");
          tempLine.setAttribute("d", "M 0 0 L 0 0");
          connectLine = { x: 0, y: 0 };
          relationshipsLayer.appendChild(tempLine);
          setSelection({ type: "field", tableId: t.id, fieldId: f.id });
          return;
        }
        setSelection({ type: "field", tableId: t.id, fieldId: f.id });
      });
      g.appendChild(row);
    });

    rect.addEventListener("click", (e) => {
      e.stopPropagation();
      if (connectSource) return;
      setSelection({ type: "table", tableId: t.id });
    });

    g.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || connectSource) return;
      if ((e.target as Element).closest("text[data-field-id]")) return;
      dragTableId = t.id;
      const pt = screenToDiagram(e.clientX, e.clientY);
      dragStart = { x: pt.x - t.x, y: pt.y - t.y };
    });

    tablesLayer.appendChild(g);
  });

  if (tempLine && connectLine) {
    const srcT = d.tables.find((t) => t.id === connectSource!.tableId);
    if (srcT) {
      const srcFi = srcT.fields.findIndex(
        (f) => f.id === connectSource!.fieldId,
      );
      const src = getFieldAnchor(srcT, srcFi >= 0 ? srcFi : 0, "right");
      tempLine.setAttribute(
        "d",
        `M ${src.x} ${src.y} L ${connectLine.x} ${connectLine.y}`,
      );
    }
  }
}

function updateTransform(): void {
  transformGroup.setAttribute(
    "transform",
    `translate(${pan.x}, ${pan.y}) scale(${zoom})`,
  );
}

function setupToolbar(): void {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const addTable = document.createElement("button");
  addTable.textContent = "Add Table";
  addTable.onclick = () => {
    const d = store.getDiagram();
    const x = (400 - pan.x) / zoom;
    const y = (200 - pan.y) / zoom;
    store.addTable(x, y);
  };
  toolbar.appendChild(addTable);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.onclick = async () => {
    if (!bridge.isBackendAvailable()) {
      showToast("Backend not available (run in Wails)");
      return;
    }
    try {
      const path = await bridge.saveFileDialog(
        "Save diagram",
        "schema.json",
        "JSON",
        "*.json",
      );
      if (path) {
        await bridge.saveFile(path, JSON.stringify(store.getDiagram()));
        showToast("Saved");
      }
    } catch (e) {
      showToast("Save failed: " + (e as Error).message);
    }
  };
  toolbar.appendChild(saveBtn);

  const loadBtn = document.createElement("button");
  loadBtn.textContent = "Load";
  loadBtn.onclick = async () => {
    if (!bridge.isBackendAvailable()) {
      showToast("Backend not available (run in Wails)");
      return;
    }
    try {
      const path = await bridge.openFileDialog(
        "Open diagram",
        "JSON",
        "*.json",
      );
      if (path) {
        const raw = await bridge.loadFile(path);
        const d = JSON.parse(raw) as Diagram;
        store.setDiagram(d);
        showToast("Loaded");
      }
    } catch (e) {
      showToast("Load failed: " + (e as Error).message);
    }
  };
  toolbar.appendChild(loadBtn);

  const undoBtn = document.createElement("button");
  undoBtn.textContent = "Undo";
  undoBtn.onclick = () => store.undo();
  toolbar.appendChild(undoBtn);

  const redoBtn = document.createElement("button");
  redoBtn.textContent = "Redo";
  redoBtn.onclick = () => store.redo();
  toolbar.appendChild(redoBtn);

  const layoutDiv = document.createElement("div");
  layoutDiv.className = "dropdown";
  const layoutBtn = document.createElement("button");
  layoutBtn.textContent = "Layout ▾";
  layoutBtn.onclick = () => layoutDiv.classList.toggle("open");
  layoutDiv.appendChild(layoutBtn);
  const layoutContent = document.createElement("div");
  layoutContent.className = "dropdown-content";
  ["grid", "hierarchical", "force"].forEach((l) => {
    const b = document.createElement("button");
    b.textContent = l.charAt(0).toUpperCase() + l.slice(1);
    b.onclick = () => {
      store.applyLayout(l as "grid" | "hierarchical" | "force");
      layoutDiv.classList.remove("open");
    };
    layoutContent.appendChild(b);
  });
  layoutDiv.appendChild(layoutContent);
  toolbar.appendChild(layoutDiv);

  const exportDiv = document.createElement("div");
  exportDiv.className = "dropdown";
  const exportBtn = document.createElement("button");
  exportBtn.textContent = "Export ▾";
  exportBtn.onclick = () => exportDiv.classList.toggle("open");
  exportDiv.appendChild(exportBtn);
  const exportContent = document.createElement("div");
  exportContent.className = "dropdown-content";
  const exportItems = [
    [
      "JSON",
      async () =>
        download(
          "schema.json",
          JSON.stringify(store.getDiagram(), null, 2),
          "application/json",
        ),
    ],
    ["SQL (PostgreSQL)", async () => exportSQL("postgres")],
    ["SQL (BigQuery)", async () => exportSQL("bigquery")],
    ["Mermaid", async () => exportMermaid()],
    ["PNG", () => exportPNG()],
    ["SVG", () => exportSVG()],
  ];
  exportItems.forEach(([label, fn]) => {
    const b = document.createElement("button");
    b.textContent = label as string;
    b.onclick = async () => {
      exportDiv.classList.remove("open");
      try {
        await (fn as () => void | Promise<void>)();
      } catch (e) {
        showToast((e as Error).message);
      }
    };
    exportContent.appendChild(b);
  });
  exportDiv.appendChild(exportContent);
  toolbar.appendChild(exportDiv);

  const importDiv = document.createElement("div");
  importDiv.className = "dropdown";
  const importBtn = document.createElement("button");
  importBtn.textContent = "Import ▾";
  importBtn.onclick = () => importDiv.classList.toggle("open");
  importDiv.appendChild(importBtn);
  const importContent = document.createElement("div");
  importContent.className = "dropdown-content";
  const importItems = [
    ["JSON", () => openAndImportJSON()],
    ["SQL", () => openAndImportSQL()],
    ["Mermaid", () => openAndImportMermaid()],
  ];
  importItems.forEach(([label, fn]) => {
    const b = document.createElement("button");
    b.textContent = label as string;
    b.onclick = () => {
      importDiv.classList.remove("open");
      (fn as () => void | Promise<void>)();
    };
    importContent.appendChild(b);
  });
  importDiv.appendChild(importContent);
  toolbar.appendChild(importDiv);

  const connectBtn = document.createElement("button");
  connectBtn.textContent = "Connect";
  connectBtn.onclick = () => {
    connectMode = !connectMode;
    if (!connectMode) {
      connectSource = null;
      if (tempLine) tempLine.remove();
      tempLine = null;
    }
    showToast(
      connectMode
        ? "Click a field, then click another field to connect"
        : "Connect mode off",
    );
  };
  toolbar.appendChild(connectBtn);

  store.subscribe(() => {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    render();
  });

  document.body.addEventListener("click", () => {
    layoutDiv.classList.remove("open");
    exportDiv.classList.remove("open");
    importDiv.classList.remove("open");
  });

  container.appendChild(toolbar);
}

function download(filename: string, content: string, mime: string): void {
  const a = document.createElement("a");
  a.href = "data:" + mime + "," + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

async function exportSQL(dialect: string): Promise<void> {
  if (!bridge.isBackendAvailable()) throw new Error("Backend not available");
  const sql = await bridge.exportSQL(
    dialect,
    JSON.stringify(store.getDiagram()),
  );
  const path = await bridge.saveFileDialog(
    "Export SQL",
    "schema.sql",
    "SQL",
    "*.sql",
  );
  if (path) {
    await bridge.saveFile(path, sql);
    showToast("Exported");
  }
}

async function exportMermaid(): Promise<void> {
  if (!bridge.isBackendAvailable()) throw new Error("Backend not available");
  const mm = await bridge.exportMermaid(JSON.stringify(store.getDiagram()));
  download("schema.mmd", mm, "text/plain");
  showToast("Exported Mermaid");
}

function exportPNG(): void {
  const svgEl = container.querySelector(".canvas-svg") as SVGElement;
  if (!svgEl) return;
  const svgData = new XMLSerializer().serializeToString(svgEl);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "schema.png";
    a.click();
    showToast("Exported PNG");
  };
  img.src =
    "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
}

function exportSVG(): void {
  const svgEl = container.querySelector(".canvas-svg") as SVGElement;
  if (!svgEl) return;
  const data = new XMLSerializer().serializeToString(svgEl);
  download("schema.svg", data, "image/svg+xml");
  showToast("Exported SVG");
}

async function openAndImportJSON(): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return;
  }
  const path = await bridge.openFileDialog("Open JSON", "JSON", "*.json");
  if (!path) return;
  const raw = await bridge.loadFile(path);
  store.setDiagram(JSON.parse(raw));
  showToast("Imported JSON");
}

async function openAndImportSQL(): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return;
  }
  const path = await bridge.openFileDialog("Open SQL", "SQL", "*.sql");
  if (!path) return;
  const raw = await bridge.loadFile(path);
  const json = await bridge.importSQL(raw);
  store.setDiagram(JSON.parse(json));
  showToast("Imported SQL");
}

async function openAndImportMermaid(): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return;
  }
  const path = await bridge.openFileDialog(
    "Open Mermaid",
    "Mermaid",
    "*.md;*.mmd",
  );
  if (!path) return;
  const raw = await bridge.loadFile(path);
  const json = await bridge.importMermaid(raw);
  store.setDiagram(JSON.parse(json));
  showToast("Imported Mermaid");
}

function setupCanvas(): void {
  const wrap = document.createElement("div");
  wrap.className = "canvas-wrap";
  svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "canvas-svg");
  transformGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  relationshipsLayer = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  tablesLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  transformGroup.appendChild(relationshipsLayer);
  transformGroup.appendChild(tablesLayer);
  svg.appendChild(transformGroup);
  wrap.appendChild(svg);
  container.appendChild(wrap);
  const resize = () => {
    const r = wrap.getBoundingClientRect();
    svg.setAttribute("width", String(r.width));
    svg.setAttribute("height", String(r.height));
  };
  resize();
  new ResizeObserver(resize).observe(wrap);

  svg.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (
      e.target === svg ||
      ((e.target as Element).closest("g.table-group") === null &&
        !(e.target as Element).closest("path.relationship-path"))
    ) {
      if (!(e.target as Element).closest("g.table-group")) {
        setSelection(null);
      }
      if (!connectSource && !(e.target as Element).closest("g.table-group")) {
        isPanning = true;
        panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      }
    }
  });

  svg.addEventListener("mousemove", (e) => {
    if (isPanning) {
      pan.x = e.clientX - panStart.x;
      pan.y = e.clientY - panStart.y;
      updateTransform();
      return;
    }
    if (dragTableId) {
      const pt = screenToDiagram(e.clientX, e.clientY);
      store.updateTablePosition(
        dragTableId,
        pt.x - dragStart.x,
        pt.y - dragStart.y,
      );
      return;
    }
    if (connectSource && connectLine) {
      const pt = screenToDiagram(e.clientX, e.clientY);
      connectLine.x = pt.x;
      connectLine.y = pt.y;
      render();
    }
  });

  svg.addEventListener("mouseup", () => {
    isPanning = false;
    dragTableId = null;
  });

  svg.addEventListener("mouseleave", () => {
    isPanning = false;
    dragTableId = null;
  });

  svg.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        zoom = Math.max(0.25, Math.min(2, zoom * factor));
        updateTransform();
      }
    },
    { passive: false },
  );

  svg.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const target = e.target as Element;
    const relPath = target.closest("path.relationship-path");
    const tableG = target.closest("g.table-group");
    const fieldRow = target.closest("text[data-field-id]");
    if (relPath) {
      const id = (relPath as HTMLElement).dataset.relationshipId!;
      showContextMenu(e.clientX, e.clientY, [
        {
          label: "Delete",
          danger: true,
          fn: () => {
            store.deleteRelationship(id);
            setSelection(null);
          },
        },
      ]);
    } else if (fieldRow) {
      const tableId = (fieldRow as HTMLElement).dataset.tableId!;
      const fieldId = (fieldRow as HTMLElement).dataset.fieldId!;
      showContextMenu(e.clientX, e.clientY, [
        {
          label: "Edit",
          fn: () => {
            /* TODO inline edit */
          },
        },
        {
          label: "Delete",
          danger: true,
          fn: () => {
            store.deleteField(tableId, fieldId);
            setSelection(null);
          },
        },
      ]);
    } else if (tableG) {
      const tableId = (tableG as HTMLElement).dataset.tableId;
      if (tableId) {
        showContextMenu(e.clientX, e.clientY, [
          { label: "Add Field", fn: () => store.addField(tableId) },
          {
            label: "Delete Table",
            danger: true,
            fn: () => {
              store.deleteTable(tableId);
              setSelection(null);
            },
          },
        ]);
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setSelection(null);
    if (e.key === "Delete" && selection) {
      if (selection.type === "table") store.deleteTable(selection.tableId);
      if (selection.type === "field")
        store.deleteField(selection.tableId, selection.fieldId);
      if (selection.type === "relationship")
        store.deleteRelationship(selection.relationshipId);
      setSelection(null);
    }
    if (e.key === "z" && e.ctrlKey) {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    }
  });
}

function showContextMenu(
  x: number,
  y: number,
  items: { label: string; danger?: boolean; fn: () => void }[],
): void {
  const existing = document.querySelector(".context-menu");
  if (existing) existing.remove();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  items.forEach(({ label, danger, fn }) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (danger) b.classList.add("danger");
    b.onclick = () => {
      fn();
      menu.remove();
    };
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const close = () => menu.remove();
  setTimeout(
    () => document.addEventListener("click", close, { once: true }),
    0,
  );
}

export function init(el: HTMLElement): void {
  container = el;
  store = new Store();
  container.innerHTML = "";
  setupToolbar();
  setupCanvas();
  render();
}
