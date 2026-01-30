import type { Diagram, Table, Field, Relationship, Selection } from "./types";
import { Store, createEmptyDiagram } from "./store";
import { FIELD_TYPES, CARDINALITY_OPTIONS } from "./types";
import {
  getRelationshipPathData,
  getFieldAnchor,
  getTableWidth,
  getTableFieldColumnStart,
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
let dragNoteId: string | null = null;
let dragNoteStart = { x: 0, y: 0 };
let resizeNoteId: string | null = null;
let connectSource: { tableId: string; fieldId: string } | null = null;
let connectLine: { x: number; y: number } | null = null;
let container: HTMLElement;
let svg: SVGElement;
let transformGroup: SVGGElement;
let tablesLayer: SVGGElement;
let relationshipsLayer: SVGGElement;
let notesLayer: SVGGElement;
const NOTE_DEFAULT_WIDTH = 200;
const NOTE_DEFAULT_HEIGHT = 140;
const MIN_NOTE_WIDTH = 80;
const MIN_NOTE_HEIGHT = 60;
const NOTE_RESIZE_HANDLE_SIZE = 14;
const EDGE_SCROLL_ZONE = 48;
const EDGE_SCROLL_SPEED = 8;
let tempLine: SVGPathElement | null = null;
let statusPanelContent: HTMLElement | null = null;
let statusPanelEl: HTMLElement | null = null;
const DEFAULT_STATUS_HEIGHT = 120;
const COLLAPSED_STATUS_HEIGHT = 28;
let statusPanelHeight = DEFAULT_STATUS_HEIGHT;
let statusPanelCollapsed = false;
let currentFilePath: string | null = null;

function appendStatus(message: string, type: "info" | "error" = "info"): void {
  if (!statusPanelContent) return;
  const line = document.createElement("div");
  line.className = "status-line status-line-" + type;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${message}`;
  statusPanelContent.appendChild(line);
  statusPanelContent.scrollTop = statusPanelContent.scrollHeight;
}

function emitSelection(): void {
  container.dispatchEvent(
    new CustomEvent("erd-selection", { detail: selection })
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

let relationshipTooltipEl: HTMLElement | null = null;

function showRelationshipTooltip(e: MouseEvent, relationshipId: string): void {
  const d = store.getDiagram();
  const r = d.relationships.find((x) => x.id === relationshipId);
  if (!r) return;
  const srcT = d.tables.find((t) => t.id === r.sourceTableId);
  const tgtT = d.tables.find((t) => t.id === r.targetTableId);
  if (!srcT || !tgtT) return;
  const srcFieldIds = r.sourceFieldIds?.length
    ? r.sourceFieldIds
    : [r.sourceFieldId];
  const tgtFieldIds = r.targetFieldIds?.length
    ? r.targetFieldIds
    : [r.targetFieldId];
  const srcNames = srcFieldIds
    .map((fid) => srcT.fields.find((f) => f.id === fid)?.name ?? fid)
    .join(", ");
  const tgtNames = tgtFieldIds
    .map((fid) => tgtT.fields.find((f) => f.id === fid)?.name ?? fid)
    .join(", ");
  const lines: string[] = [];
  if (r.name?.trim()) lines.push(`Name: ${r.name.trim()}`);
  if (r.cardinality?.trim()) lines.push(`Cardinality: ${r.cardinality}`);
  lines.push(`Source: ${srcT.name}.${srcNames}`);
  lines.push(`Target: ${tgtT.name}.${tgtNames}`);
  if (!relationshipTooltipEl) {
    relationshipTooltipEl = document.createElement("div");
    relationshipTooltipEl.className = "relationship-tooltip";
    document.body.appendChild(relationshipTooltipEl);
  }
  relationshipTooltipEl.innerHTML = lines
    .map((s) => `<div>${escapeHtml(s)}</div>`)
    .join("");
  relationshipTooltipEl.style.display = "block";
  const offset = 14;
  let left = e.clientX + offset;
  let top = e.clientY + offset;
  relationshipTooltipEl.style.left = `${left}px`;
  relationshipTooltipEl.style.top = `${top}px`;
  const rect = relationshipTooltipEl.getBoundingClientRect();
  if (rect.right > window.innerWidth) left = e.clientX - rect.width - offset;
  if (rect.bottom > window.innerHeight) top = e.clientY - rect.height - offset;
  if (rect.top < 0) top = offset;
  if (rect.left < 0) left = offset;
  relationshipTooltipEl.style.left = `${left}px`;
  relationshipTooltipEl.style.top = `${top}px`;
}

function hideRelationshipTooltip(): void {
  if (relationshipTooltipEl) relationshipTooltipEl.style.display = "none";
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
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
  notesLayer.innerHTML = "";

  d.relationships.forEach((r) => {
    const pathDataList = getRelationshipPathData(d, r);
    const pathClass =
      "relationship-path" +
      (selection?.type === "relationship" && selection.relationshipId === r.id
        ? " selected"
        : "");
    pathDataList.forEach((item) => {
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      path.setAttribute("d", item.pathD);
      path.setAttribute("class", pathClass);
      path.dataset.relationshipId = r.id;
      const showRelTooltip = (e: MouseEvent) => {
        if (!dragTableId) showRelationshipTooltip(e, r.id);
      };
      const hideRelTooltip = () => hideRelationshipTooltip();
      path.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelection({ type: "relationship", relationshipId: r.id });
      });
      path.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        showRelationshipDialog(
          r.sourceTableId,
          r.sourceFieldId,
          r.targetTableId,
          r.id
        );
      });
      path.addEventListener("mouseenter", showRelTooltip);
      path.addEventListener("mouseleave", hideRelTooltip);
      relationshipsLayer.appendChild(path);
      const arrow = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );
      arrow.setAttribute("d", item.arrowheadPathD);
      arrow.setAttribute("class", pathClass + " relationship-arrowhead");
      arrow.dataset.relationshipId = r.id;
      arrow.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelection({ type: "relationship", relationshipId: r.id });
      });
      arrow.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        showRelationshipDialog(
          r.sourceTableId,
          r.sourceFieldId,
          r.targetTableId,
          r.id
        );
      });
      arrow.addEventListener("mouseenter", showRelTooltip);
      arrow.addEventListener("mouseleave", hideRelTooltip);
      relationshipsLayer.appendChild(arrow);
    });
  });

  (d.notes ?? []).forEach((note) => {
    const noteG = document.createElementNS("http://www.w3.org/2000/svg", "g");
    noteG.setAttribute("class", "canvas-note");
    noteG.setAttribute("data-note-id", note.id);
    noteG.setAttribute("transform", `translate(${note.x}, ${note.y})`);
    const w = note.width ?? NOTE_DEFAULT_WIDTH;
    const h = note.height ?? NOTE_DEFAULT_HEIGHT;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "4");
    rect.setAttribute("class", "canvas-note-rect");
    noteG.appendChild(rect);
    const fo = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "foreignObject"
    );
    fo.setAttribute("width", String(w));
    fo.setAttribute("height", String(h));
    fo.setAttribute("x", "0");
    fo.setAttribute("y", "0");
    const div = document.createElement("div");
    div.className = "canvas-note-text";
    div.textContent = note.text || "Double-click to edit";
    fo.appendChild(div);
    noteG.appendChild(fo);
    const resizeHandle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );
    resizeHandle.setAttribute("x", String(w - NOTE_RESIZE_HANDLE_SIZE));
    resizeHandle.setAttribute("y", String(h - NOTE_RESIZE_HANDLE_SIZE));
    resizeHandle.setAttribute("width", String(NOTE_RESIZE_HANDLE_SIZE));
    resizeHandle.setAttribute("height", String(NOTE_RESIZE_HANDLE_SIZE));
    resizeHandle.setAttribute("class", "canvas-note-resize-handle");
    resizeHandle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      resizeNoteId = note.id;
      setupDocumentDragListeners();
    });
    noteG.appendChild(resizeHandle);
    noteG.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as Element).closest(".canvas-note-resize-handle")) return;
      e.stopPropagation();
      const pt = screenToDiagram(e.clientX, e.clientY);
      dragNoteId = note.id;
      dragNoteStart = { x: pt.x - note.x, y: pt.y - note.y };
      setupDocumentDragListeners();
    });
    noteG.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      showNoteEditor(note.x, note.y, note.id);
    });
    notesLayer.appendChild(noteG);
  });

  d.tables.forEach((t) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute(
      "class",
      "table-group" +
        (selection?.type === "table" && selection.tableId === t.id
          ? " selected"
          : "")
    );
    g.setAttribute("transform", `translate(${t.x}, ${t.y})`);
    g.setAttribute("data-table-id", t.id);

    const w = getTableWidth(t);
    const h = HEADER_HEIGHT + t.fields.length * ROW_HEIGHT;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("class", "table-rect");
    rect.setAttribute("rx", "6");
    g.appendChild(rect);

    const headerRect = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );
    headerRect.setAttribute("width", String(w));
    headerRect.setAttribute("height", String(HEADER_HEIGHT));
    headerRect.setAttribute("class", "table-header-rect");
    headerRect.setAttribute("rx", "6");
    g.appendChild(headerRect);

    const headerLine = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );
    headerLine.setAttribute("x1", "0");
    headerLine.setAttribute("y1", String(HEADER_HEIGHT));
    headerLine.setAttribute("x2", String(w));
    headerLine.setAttribute("y2", String(HEADER_HEIGHT));
    headerLine.setAttribute("class", "table-header-line");
    g.appendChild(headerLine);

    const header = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    header.setAttribute("x", "10");
    header.setAttribute("y", String(HEADER_HEIGHT - 8));
    header.setAttribute("class", "table-header");
    header.textContent = t.name;
    g.appendChild(header);

    const typeColumnStart = getTableFieldColumnStart(t);
    t.fields.forEach((f, i) => {
      const rowY = HEADER_HEIGHT + (i + 1) * ROW_HEIGHT - 6;
      const fieldClass =
        "table-field" +
        (selection?.type === "field" &&
        selection.tableId === t.id &&
        selection.fieldId === f.id
          ? " selected"
          : "");
      const rowGroup = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g"
      );
      rowGroup.dataset.tableId = t.id;
      rowGroup.dataset.fieldId = f.id;
      rowGroup.style.cursor = "pointer";

      const nameText = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      nameText.setAttribute("x", "10");
      nameText.setAttribute("y", String(rowY));
      nameText.setAttribute("class", fieldClass);
      nameText.textContent = f.name;

      const typeText = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      typeText.setAttribute("x", String(typeColumnStart));
      typeText.setAttribute("y", String(rowY));
      typeText.setAttribute("class", fieldClass);
      typeText.textContent = f.type;

      rowGroup.appendChild(nameText);
      rowGroup.appendChild(typeText);

      rowGroup.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        connectSource = { tableId: t.id, fieldId: f.id };
        tempLine = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path"
        );
        tempLine.setAttribute("class", "relationship-path");
        tempLine.setAttribute("d", "M 0 0 L 0 0");
        connectLine = { x: 0, y: 0 };
        relationshipsLayer.appendChild(tempLine);
      });
      rowGroup.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelection({ type: "field", tableId: t.id, fieldId: f.id });
      });
      g.appendChild(rowGroup);
    });

    rect.addEventListener("click", (e) => {
      e.stopPropagation();
      setSelection({ type: "table", tableId: t.id });
    });

    g.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as Element).closest("[data-field-id]")) return;
      dragTableId = t.id;
      const pt = screenToDiagram(e.clientX, e.clientY);
      dragStart = { x: pt.x - t.x, y: pt.y - t.y };
      setupDocumentDragListeners();
    });

    g.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if ((e.target as Element).closest("[data-field-id]")) return;
      showTableEditor(t.id);
    });

    tablesLayer.appendChild(g);
  });

  if (tempLine && connectLine) {
    const srcT = d.tables.find((t) => t.id === connectSource!.tableId);
    if (srcT) {
      const srcFi = srcT.fields.findIndex(
        (f) => f.id === connectSource!.fieldId
      );
      const src = getFieldAnchor(srcT, srcFi >= 0 ? srcFi : 0, "right");
      tempLine.setAttribute(
        "d",
        `M ${src.x} ${src.y} L ${connectLine.x} ${connectLine.y}`
      );
    }
  }
}

function updateTransform(): void {
  transformGroup.setAttribute(
    "transform",
    `translate(${pan.x}, ${pan.y}) scale(${zoom})`
  );
}

function onDocumentDragMove(e: MouseEvent): void {
  if (dragTableId) {
    const pt = screenToDiagram(e.clientX, e.clientY);
    store.updateTablePosition(
      dragTableId,
      pt.x - dragStart.x,
      pt.y - dragStart.y
    );
    const r = svg.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    const left = e.clientX - r.left;
    const right = r.right - e.clientX;
    const top = e.clientY - r.top;
    const bottom = r.bottom - e.clientY;
    if (left < EDGE_SCROLL_ZONE) dx = (EDGE_SCROLL_ZONE - left) * 0.2;
    if (right < EDGE_SCROLL_ZONE) dx = -(EDGE_SCROLL_ZONE - right) * 0.2;
    if (top < EDGE_SCROLL_ZONE) dy = (EDGE_SCROLL_ZONE - top) * 0.2;
    if (bottom < EDGE_SCROLL_ZONE) dy = -(EDGE_SCROLL_ZONE - bottom) * 0.2;
    if (dx !== 0 || dy !== 0) {
      pan.x += dx * EDGE_SCROLL_SPEED;
      pan.y += dy * EDGE_SCROLL_SPEED;
      updateTransform();
    }
    return;
  }
  if (resizeNoteId) {
    const pt = screenToDiagram(e.clientX, e.clientY);
    const note = store.getDiagram().notes?.find((n) => n.id === resizeNoteId);
    if (note) {
      const newW = Math.max(MIN_NOTE_WIDTH, pt.x - note.x);
      const newH = Math.max(MIN_NOTE_HEIGHT, pt.y - note.y);
      store.updateNoteSize(resizeNoteId, newW, newH);
    }
    return;
  }
  if (dragNoteId) {
    const pt = screenToDiagram(e.clientX, e.clientY);
    store.updateNotePosition(
      dragNoteId,
      pt.x - dragNoteStart.x,
      pt.y - dragNoteStart.y
    );
  }
}

function onDocumentDragUp(): void {
  if (dragTableId === null && dragNoteId === null && resizeNoteId === null)
    return;
  document.removeEventListener("mousemove", onDocumentDragMove);
  document.removeEventListener("mouseup", onDocumentDragUp);
  dragTableId = null;
  dragNoteId = null;
  resizeNoteId = null;
}

function setupDocumentDragListeners(): void {
  document.addEventListener("mousemove", onDocumentDragMove);
  document.addEventListener("mouseup", onDocumentDragUp);
}

/** Returns true if save completed (or no backend), false on cancel or error. */
async function saveDiagram(): Promise<boolean> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return false;
  }
  let path = currentFilePath;
  if (!path) {
    try {
      path = await bridge.saveFileDialog(
        "Save diagram",
        "schema.diagram",
        "Diagram",
        "*.diagram"
      );
    } catch (e) {
      showToast("Save failed: " + (e as Error).message);
      return false;
    }
    if (!path) return false;
    currentFilePath = path;
  }
  try {
    await bridge.saveFile(path, JSON.stringify(store.getDiagram()));
    store.clearDirty();
    appendStatus(`Saved ${path}`);
    return true;
  } catch (e) {
    showToast("Save failed: " + (e as Error).message);
    return false;
  }
}

function confirmUnsavedChanges(): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    const existing = document.querySelector(".modal-overlay");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const panel = document.createElement("div");
    panel.className = "modal-panel modal-panel-unsaved";
    const p = document.createElement("p");
    p.textContent = "Save changes before creating a new diagram?";
    p.style.margin = "0 0 1rem 0";
    panel.appendChild(p);
    const btnDiv = document.createElement("div");
    btnDiv.style.display = "flex";
    btnDiv.style.gap = "0.5rem";
    btnDiv.style.justifyContent = "flex-end";
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.onclick = () => {
      overlay.remove();
      resolve("save");
    };
    const discardBtn = document.createElement("button");
    discardBtn.textContent = "Discard";
    discardBtn.onclick = () => {
      overlay.remove();
      resolve("discard");
    };
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => {
      overlay.remove();
      resolve("cancel");
    };
    btnDiv.appendChild(saveBtn);
    btnDiv.appendChild(discardBtn);
    btnDiv.appendChild(cancelBtn);
    panel.appendChild(btnDiv);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
}

async function openDiagramFile(): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return;
  }
  try {
    const path = await bridge.openFileDialog(
      "Open diagram",
      "Diagram",
      "*.diagram"
    );
    if (path) {
      const raw = await bridge.loadFile(path);
      const d = JSON.parse(raw) as Diagram;
      store.setDiagram(d);
      store.clearDirty();
      currentFilePath = path;
      render();
      appendStatus(`Opened ${path}`);
      showToast("Opened");
    }
  } catch (e) {
    showToast("Open failed: " + (e as Error).message);
  }
}

function setupToolbar(): void {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const newBtn = document.createElement("button");
  newBtn.textContent = "New";
  newBtn.onclick = async () => {
    if (store.isDirty()) {
      const choice = await confirmUnsavedChanges();
      if (choice === "cancel") return;
      if (choice === "save") {
        const saved = await saveDiagram();
        if (!saved) return;
      }
    }
    store.setDiagram(createEmptyDiagram());
    store.clearDirty();
    currentFilePath = null;
    render();
    appendStatus("New diagram.");
    showToast("New diagram");
  };
  toolbar.appendChild(newBtn);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.onclick = async () => {
    const saved = await saveDiagram();
    if (saved) showToast("Saved");
  };
  toolbar.appendChild(saveBtn);

  const openBtn = document.createElement("button");
  openBtn.textContent = "Open File";
  openBtn.onclick = () => openDiagramFile();
  toolbar.appendChild(openBtn);

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
  layoutBtn.onclick = () => {
    exportDiv.classList.remove("open");
    importDiv.classList.remove("open");
    layoutDiv.classList.toggle("open");
  };
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
  exportBtn.onclick = () => {
    layoutDiv.classList.remove("open");
    importDiv.classList.remove("open");
    exportDiv.classList.toggle("open");
  };
  exportDiv.appendChild(exportBtn);
  const exportContent = document.createElement("div");
  exportContent.className = "dropdown-content";
  const exportItems = [
    ["JSON", async () => exportJSON()],
    ["SQL (PostgreSQL)", async () => exportPostgresSQL()],
    ["SQL (BigQuery)", async () => exportBigQuerySQL()],
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
  importBtn.onclick = () => {
    layoutDiv.classList.remove("open");
    exportDiv.classList.remove("open");
    importDiv.classList.toggle("open");
  };
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

  const themeBtn = document.createElement("button");
  themeBtn.title = "Toggle dark/light theme";
  function updateThemeButton(): void {
    const theme = document.documentElement.getAttribute("data-theme") ?? "dark";
    themeBtn.textContent = theme === "dark" ? "☀ Light" : "🌙 Dark";
  }
  themeBtn.onclick = () => {
    const theme = document.documentElement.getAttribute("data-theme") ?? "dark";
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("erd-theme", next);
    } catch (_) {}
    updateThemeButton();
  };
  const savedTheme = (() => {
    try {
      return localStorage.getItem("erd-theme");
    } catch {
      return null;
    }
  })();
  if (savedTheme === "light" || savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", savedTheme);
  }
  updateThemeButton();
  toolbar.appendChild(themeBtn);

  store.subscribe(() => {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    render();
  });

  document.body.addEventListener("click", (e) => {
    if (!(e.target as Element).closest(".dropdown")) {
      layoutDiv.classList.remove("open");
      exportDiv.classList.remove("open");
      importDiv.classList.remove("open");
    }
  });

  container.appendChild(toolbar);
}

function download(filename: string, content: string, mime: string): void {
  const a = document.createElement("a");
  a.href = "data:" + mime + "," + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

async function exportJSON(): Promise<void> {
  const content = JSON.stringify(store.getDiagram(), null, 2);
  if (bridge.isBackendAvailable()) {
    const path = await bridge.saveFileDialog(
      "Export JSON",
      "schema.json",
      "JSON",
      "*.json"
    );
    if (path) {
      await bridge.saveFile(path, content);
      showToast("Exported");
    }
  } else {
    download("schema.json", content, "application/json");
    showToast("Exported JSON");
  }
}

async function exportSQL(dialect: string): Promise<void> {
  if (!bridge.isBackendAvailable()) throw new Error("Backend not available");
  const sql = await bridge.exportSQL(
    dialect,
    JSON.stringify(store.getDiagram())
  );
  const path = await bridge.saveFileDialog(
    "Export SQL",
    "schema.sql",
    "SQL",
    "*.sql"
  );
  if (path) {
    await bridge.saveFile(path, sql);
    showToast("Exported");
  }
}

function promptPostgresOptions(): Promise<{ schema: string } | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(".modal-overlay");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const panel = document.createElement("div");
    panel.className = "modal-panel modal-panel-postgres-export";
    const headerDiv = document.createElement("div");
    headerDiv.className = "modal-postgres-export-header";
    const title = document.createElement("h2");
    title.className = "modal-title";
    title.textContent = "PostgreSQL Export";
    headerDiv.appendChild(title);
    panel.appendChild(headerDiv);
    const contentDiv = document.createElement("div");
    contentDiv.className = "modal-postgres-export-content";
    let specifySchemaOn = false;
    const specifySchemaToggle = document.createElement("button");
    specifySchemaToggle.type = "button";
    specifySchemaToggle.className = "modal-toggle";
    specifySchemaToggle.setAttribute("aria-pressed", "false");
    specifySchemaToggle.innerHTML =
      '<span class="modal-toggle-track"><span class="modal-toggle-thumb"></span></span><span class="modal-toggle-label">Specify Schema</span>';
    const specifySchemaRow = document.createElement("div");
    specifySchemaRow.className = "modal-postgres-specify-schema-row";
    specifySchemaRow.appendChild(specifySchemaToggle);
    contentDiv.appendChild(specifySchemaRow);
    const schemaRow = document.createElement("div");
    schemaRow.className = "modal-postgres-schema-row";
    schemaRow.style.display = "none";
    const schemaLabel = document.createElement("label");
    schemaLabel.textContent = "Schema";
    schemaLabel.className = "modal-label";
    const schemaInput = document.createElement("input");
    schemaInput.type = "text";
    schemaInput.placeholder = "public";
    schemaInput.className = "modal-input";
    schemaRow.appendChild(schemaLabel);
    schemaRow.appendChild(schemaInput);
    contentDiv.appendChild(schemaRow);
    specifySchemaToggle.addEventListener("click", () => {
      specifySchemaOn = !specifySchemaOn;
      specifySchemaToggle.classList.toggle("modal-toggle-on", specifySchemaOn);
      specifySchemaToggle.setAttribute(
        "aria-pressed",
        String(specifySchemaOn)
      );
      schemaRow.style.display = specifySchemaOn ? "block" : "none";
    });
    panel.appendChild(contentDiv);
    const footerDiv = document.createElement("div");
    footerDiv.className = "modal-postgres-export-footer";
    const footerButtons = document.createElement("div");
    footerButtons.className = "modal-postgres-export-footer-buttons";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.textContent = "OK";
    okBtn.onclick = () => {
      overlay.remove();
      resolve({
        schema: specifySchemaOn ? schemaInput.value.trim() : "",
      });
    };
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => {
      overlay.remove();
      resolve(null);
    };
    footerButtons.appendChild(okBtn);
    footerButtons.appendChild(cancelBtn);
    footerDiv.appendChild(footerButtons);
    panel.appendChild(footerDiv);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
}

async function exportPostgresSQL(): Promise<void> {
  if (!bridge.isBackendAvailable()) throw new Error("Backend not available");
  const options = await promptPostgresOptions();
  if (options === null) return;
  const sql = await bridge.exportPostgres(
    JSON.stringify(store.getDiagram()),
    options.schema
  );
  const path = await bridge.saveFileDialog(
    "Export SQL",
    "schema.sql",
    "SQL",
    "*.sql"
  );
  if (path) {
    await bridge.saveFile(path, sql);
    showToast("Exported");
  }
}

function promptBigQueryTarget(): Promise<{
  project: string;
  dataset: string;
  creationMode: string;
} | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(".modal-overlay");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const panel = document.createElement("div");
    panel.className = "modal-panel modal-panel-bigquery-target";
    const headerDiv = document.createElement("div");
    headerDiv.className = "modal-bigquery-target-header";
    const title = document.createElement("h2");
    title.className = "modal-title";
    title.textContent = "BigQuery Export";
    headerDiv.appendChild(title);
    panel.appendChild(headerDiv);
    const contentDiv = document.createElement("div");
    contentDiv.className = "modal-bigquery-target-content";
    const projectLabel = document.createElement("label");
    projectLabel.textContent = "Project";
    projectLabel.className = "modal-label";
    const projectInput = document.createElement("input");
    projectInput.type = "text";
    projectInput.placeholder = "my-gcp-project";
    projectInput.className = "modal-input";
    const datasetLabel = document.createElement("label");
    datasetLabel.textContent = "Dataset";
    datasetLabel.className = "modal-label";
    const datasetInput = document.createElement("input");
    datasetInput.type = "text";
    datasetInput.placeholder = "my_dataset";
    datasetInput.className = "modal-input";
    let useCreationModeOn = false;
    const useCreationModeToggle = document.createElement("button");
    useCreationModeToggle.type = "button";
    useCreationModeToggle.className = "modal-toggle";
    useCreationModeToggle.setAttribute("aria-pressed", "false");
    useCreationModeToggle.innerHTML =
      '<span class="modal-toggle-track"><span class="modal-toggle-thumb"></span></span><span class="modal-toggle-label">Use create statement modifier</span>';
    const creationModeRow = document.createElement("div");
    creationModeRow.className = "modal-bigquery-creation-mode-row";
    creationModeRow.appendChild(useCreationModeToggle);
    const creationModeSelect = document.createElement("select");
    creationModeSelect.className = "modal-input";
    creationModeSelect.disabled = true;
    const optIfNotExists = document.createElement("option");
    optIfNotExists.value = "if_not_exists";
    optIfNotExists.textContent = "if not exists";
    const optCreateOrReplace = document.createElement("option");
    optCreateOrReplace.value = "create_or_replace";
    optCreateOrReplace.textContent = "create or replace";
    creationModeSelect.appendChild(optIfNotExists);
    creationModeSelect.appendChild(optCreateOrReplace);
    useCreationModeToggle.addEventListener("click", () => {
      useCreationModeOn = !useCreationModeOn;
      useCreationModeToggle.classList.toggle("modal-toggle-on", useCreationModeOn);
      useCreationModeToggle.setAttribute(
        "aria-pressed",
        String(useCreationModeOn)
      );
      creationModeSelect.disabled = !useCreationModeOn;
    });
    contentDiv.appendChild(projectLabel);
    contentDiv.appendChild(projectInput);
    contentDiv.appendChild(datasetLabel);
    contentDiv.appendChild(datasetInput);
    contentDiv.appendChild(creationModeRow);
    contentDiv.appendChild(creationModeSelect);
    panel.appendChild(contentDiv);
    const footerDiv = document.createElement("div");
    footerDiv.className = "modal-bigquery-target-footer";
    const footerButtons = document.createElement("div");
    footerButtons.className = "modal-bigquery-target-footer-buttons";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.textContent = "OK";
    okBtn.onclick = () => {
      const project = projectInput.value.trim();
      const dataset = datasetInput.value.trim();
      if (!project || !dataset) {
        showToast("Enter both project and dataset");
        return;
      }
      overlay.remove();
      resolve({
        project,
        dataset,
        creationMode: useCreationModeOn ? creationModeSelect.value : "",
      });
    };
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => {
      overlay.remove();
      resolve(null);
    };
    footerButtons.appendChild(okBtn);
    footerButtons.appendChild(cancelBtn);
    footerDiv.appendChild(footerButtons);
    panel.appendChild(footerDiv);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
}

async function exportBigQuerySQL(): Promise<void> {
  if (!bridge.isBackendAvailable()) throw new Error("Backend not available");
  const target = await promptBigQueryTarget();
  if (!target) return;
  const sql = await bridge.exportBigQuery(
    JSON.stringify(store.getDiagram()),
    target.project,
    target.dataset,
    target.creationMode
  );
  const path = await bridge.saveFileDialog(
    "Export SQL",
    "schema.sql",
    "SQL",
    "*.sql"
  );
  if (path) {
    await bridge.saveFile(path, sql);
    showToast("Exported");
  }
}

async function exportMermaid(): Promise<void> {
  if (!bridge.isBackendAvailable()) throw new Error("Backend not available");
  const mm = await bridge.exportMermaid(JSON.stringify(store.getDiagram()));
  const path = await bridge.saveFileDialog(
    "Export Mermaid",
    "schema.mmd",
    "Mermaid",
    "*.mmd"
  );
  if (path) {
    await bridge.saveFile(path, mm);
    showToast("Exported");
  }
}

const PNG_EXPORT_SCALE = 3; // higher resolution (e.g. 3x logical size)
const PNG_EXPORT_PADDING = 40;

// Same font as canvas (styles.css) so export metrics match and columns don't overlap
const EXPORT_CANVAS_STYLES = `
  .table-rect { fill: #ffffff !important; stroke: #bcc0cc !important; }
  .table-header-rect { fill: #e6e9ef !important; }
  .table-header-line { stroke: #bcc0cc !important; }
  .table-header { fill: #1e66f5 !important; font-family: system-ui, -apple-system, sans-serif !important; font-size: 14px !important; font-weight: 600 !important; }
  .table-field { fill: #4c4f69 !important; font-family: system-ui, -apple-system, sans-serif !important; font-size: 12px !important; }
  .relationship-path { stroke: #bcc0cc !important; fill: none !important; }
  .relationship-path.selected { stroke: #1e66f5 !important; }
  .relationship-arrowhead { fill: #bcc0cc !important; stroke: none !important; }
  .relationship-arrowhead.selected { fill: #1e66f5 !important; }
`;

async function exportPNG(): Promise<void> {
  const svgEl = container.querySelector(".canvas-svg") as SVGElement;
  if (!svgEl) return;
  const d = store.getDiagram();
  if (d.tables.length === 0) {
    showToast("No tables to export");
    return;
  }
  let savePath: string | null = null;
  if (bridge.isBackendAvailable()) {
    savePath = await bridge.saveFileDialog(
      "Export PNG",
      "schema.png",
      "PNG",
      "*.png"
    );
    if (!savePath) return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of d.tables) {
    const w = getTableWidth(t);
    const h = HEADER_HEIGHT + t.fields.length * ROW_HEIGHT;
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + w);
    maxY = Math.max(maxY, t.y + h);
  }
  const pad = PNG_EXPORT_PADDING;
  const width = maxX - minX + 2 * pad;
  const height = maxY - minY + 2 * pad;

  const clone = svgEl.cloneNode(true) as SVGElement;
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = EXPORT_CANVAS_STYLES;
  clone.insertBefore(style, clone.firstChild);
  const group = clone.querySelector("g") as SVGGElement;
  if (group) {
    group.setAttribute("transform", `translate(${pad - minX}, ${pad - minY})`);
  }
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  clone.setAttribute("width", String(Math.round(width * PNG_EXPORT_SCALE)));
  clone.setAttribute("height", String(Math.round(height * PNG_EXPORT_SCALE)));

  const svgData = new XMLSerializer().serializeToString(clone);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const img = new Image();
  const pathToSave = savePath;
  img.onload = async () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    if (pathToSave) {
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      await bridge.saveFileBase64(pathToSave, base64);
      showToast("Exported");
    } else {
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "schema.png";
      a.click();
      showToast("Exported PNG");
    }
  };
  img.src =
    "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
}

const SVG_EXPORT_PADDING = 40;

async function exportSVG(): Promise<void> {
  const svgEl = container.querySelector(".canvas-svg") as SVGElement;
  if (!svgEl) return;
  const d = store.getDiagram();
  if (d.tables.length === 0) {
    showToast("No tables to export");
    return;
  }
  if (bridge.isBackendAvailable()) {
    const path = await bridge.saveFileDialog(
      "Export SVG",
      "schema.svg",
      "SVG",
      "*.svg"
    );
    if (!path) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of d.tables) {
      const w = getTableWidth(t);
      const h = HEADER_HEIGHT + t.fields.length * ROW_HEIGHT;
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + w);
      maxY = Math.max(maxY, t.y + h);
    }
    const pad = SVG_EXPORT_PADDING;
    const width = maxX - minX + 2 * pad;
    const height = maxY - minY + 2 * pad;

    const clone = svgEl.cloneNode(true) as SVGElement;
    const style = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "style"
    );
    style.textContent = EXPORT_CANVAS_STYLES;
    clone.insertBefore(style, clone.firstChild);
    const group = clone.querySelector("g") as SVGGElement;
    if (group) {
      group.setAttribute(
        "transform",
        `translate(${pad - minX}, ${pad - minY})`
      );
    }
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    const data = new XMLSerializer().serializeToString(clone);
    await bridge.saveFile(path, data);
    showToast("Exported");
  } else {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of d.tables) {
      const w = getTableWidth(t);
      const h = HEADER_HEIGHT + t.fields.length * ROW_HEIGHT;
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + w);
      maxY = Math.max(maxY, t.y + h);
    }
    const pad = SVG_EXPORT_PADDING;
    const width = maxX - minX + 2 * pad;
    const height = maxY - minY + 2 * pad;

    const clone = svgEl.cloneNode(true) as SVGElement;
    const style = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "style"
    );
    style.textContent = EXPORT_CANVAS_STYLES;
    clone.insertBefore(style, clone.firstChild);
    const group = clone.querySelector("g") as SVGGElement;
    if (group) {
      group.setAttribute(
        "transform",
        `translate(${pad - minX}, ${pad - minY})`
      );
    }
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    const data = new XMLSerializer().serializeToString(clone);
    download("schema.svg", data, "image/svg+xml");
    showToast("Exported SVG");
  }
}

async function openAndImportJSON(): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return;
  }
  const path = await bridge.openFileDialog("Open JSON", "JSON", "*.json");
  if (!path) return;
  try {
    const raw = await bridge.loadFile(path);
    const d = JSON.parse(raw) as Diagram;
    store.setDiagram(d);
    appendStatus(`Imported JSON from ${path}: ${d.tables.length} tables`);
    showToast("Imported JSON");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendStatus(`JSON import failed: ${msg}`, "error");
    showToast("Import failed");
  }
}

async function openAndImportSQL(): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return;
  }
  const path = await bridge.openFileDialog("Open SQL", "SQL", "*.sql");
  if (!path) return;
  try {
    const raw = await bridge.loadFile(path);
    const json = await bridge.importSQL(raw);
    const d = JSON.parse(json) as Diagram;
    store.setDiagram(d);
    appendStatus(
      `Imported SQL from ${path}: ${d.tables.length} tables, ${d.relationships.length} relationships`
    );
    if (d.tables.length === 0) {
      appendStatus(
        "No CREATE TABLE statements found. The parser expects PostgreSQL-style DDL: CREATE TABLE name ( col type, ... ); with optional PRIMARY KEY and FOREIGN KEY.",
        "error"
      );
      showToast("No tables found — check Status panel for expected format");
    } else {
      showToast("Imported SQL");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendStatus(`SQL import failed: ${msg}`, "error");
    showToast("Import failed");
  }
}

async function openAndImportMermaid(): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return;
  }
  const path = await bridge.openFileDialog(
    "Open Mermaid",
    "Mermaid",
    "*.md;*.mmd"
  );
  if (!path) return;
  try {
    const raw = await bridge.loadFile(path);
    const json = await bridge.importMermaid(raw);
    const d = JSON.parse(json) as Diagram;
    store.setDiagram(d);
    appendStatus(`Imported Mermaid from ${path}: ${d.tables.length} tables`);
    if (d.tables.length === 0) {
      appendStatus(
        "No entities found. Expected Mermaid erDiagram with entity { } blocks.",
        "error"
      );
    }
    showToast("Imported Mermaid");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendStatus(`Mermaid import failed: ${msg}`, "error");
    showToast("Import failed");
  }
}

function setupStatusPanel(): void {
  const panel = document.createElement("div");
  panel.className = "status-panel";
  panel.style.height = statusPanelHeight + "px";
  statusPanelEl = panel;
  const header = document.createElement("div");
  header.className = "status-panel-header";
  const label = document.createElement("span");
  label.textContent = "Status";
  label.className = "status-panel-label";
  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.className = "status-panel-collapse";
  collapseBtn.textContent = "−";
  collapseBtn.title = "Collapse / Expand";
  collapseBtn.onclick = (e) => {
    e.stopPropagation();
    statusPanelCollapsed = !statusPanelCollapsed;
    if (statusPanelCollapsed) {
      panel.style.height = COLLAPSED_STATUS_HEIGHT + "px";
      panel.classList.add("status-panel-collapsed");
      collapseBtn.textContent = "▲";
      collapseBtn.title = "Click to show status panel";
      label.textContent = "Status — click to expand";
    } else {
      panel.style.height = statusPanelHeight + "px";
      panel.classList.remove("status-panel-collapsed");
      collapseBtn.textContent = "−";
      collapseBtn.title = "Collapse / Expand";
      label.textContent = "Status";
    }
  };
  header.appendChild(label);
  header.appendChild(collapseBtn);
  header.onclick = () => {
    if (statusPanelCollapsed) {
      statusPanelCollapsed = false;
      panel.style.height = statusPanelHeight + "px";
      panel.classList.remove("status-panel-collapsed");
      collapseBtn.textContent = "−";
      collapseBtn.title = "Collapse / Expand";
      label.textContent = "Status";
    }
  };
  panel.appendChild(header);
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "status-panel-resize";
  resizeHandle.title = "Drag to resize";
  let resizeStartY = 0;
  let resizeStartH = 0;
  resizeHandle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeStartY = e.clientY;
    resizeStartH = statusPanelHeight;
    const onMove = (e2: MouseEvent) => {
      const dy = resizeStartY - e2.clientY;
      const newH = Math.max(60, Math.min(400, resizeStartH + dy));
      statusPanelHeight = newH;
      if (!statusPanelCollapsed) {
        panel.style.height = newH + "px";
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  panel.appendChild(resizeHandle);
  const content = document.createElement("div");
  content.className = "status-panel-content";
  statusPanelContent = content;
  panel.appendChild(content);
  container.appendChild(panel);
}

function setupCanvas(): void {
  const wrap = document.createElement("div");
  wrap.className = "canvas-wrap";
  svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "canvas-svg");
  transformGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  relationshipsLayer = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g"
  );
  tablesLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  transformGroup.appendChild(relationshipsLayer);
  transformGroup.appendChild(tablesLayer);
  notesLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  transformGroup.appendChild(notesLayer);
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
  setupStatusPanel();

  svg.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("g.canvas-note")) return;
    if (
      e.target === svg ||
      ((e.target as Element).closest("g.table-group") === null &&
        !(e.target as Element).closest("path.relationship-path"))
    ) {
      if (!(e.target as Element).closest("g.table-group")) {
        setSelection(null);
      }
      if (!(e.target as Element).closest("g.table-group")) {
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
        pt.y - dragStart.y
      );
      const r = svg.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      const left = e.clientX - r.left;
      const right = r.right - e.clientX;
      const top = e.clientY - r.top;
      const bottom = r.bottom - e.clientY;
      if (left < EDGE_SCROLL_ZONE) dx = (EDGE_SCROLL_ZONE - left) * 0.2;
      if (right < EDGE_SCROLL_ZONE) dx = -(EDGE_SCROLL_ZONE - right) * 0.2;
      if (top < EDGE_SCROLL_ZONE) dy = (EDGE_SCROLL_ZONE - top) * 0.2;
      if (bottom < EDGE_SCROLL_ZONE) dy = -(EDGE_SCROLL_ZONE - bottom) * 0.2;
      if (dx !== 0 || dy !== 0) {
        pan.x += dx * EDGE_SCROLL_SPEED;
        pan.y += dy * EDGE_SCROLL_SPEED;
        updateTransform();
      }
      return;
    }
    if (dragNoteId) {
      const pt = screenToDiagram(e.clientX, e.clientY);
      store.updateNotePosition(
        dragNoteId,
        pt.x - dragNoteStart.x,
        pt.y - dragNoteStart.y
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

  svg.addEventListener("mouseup", (e) => {
    if (connectSource) {
      const pt = screenToDiagram(e.clientX, e.clientY);
      const d = store.getDiagram();
      const targetTable = d.tables.find((t) => {
        const w = getTableWidth(t);
        const h = HEADER_HEIGHT + t.fields.length * ROW_HEIGHT;
        return pt.x >= t.x && pt.x <= t.x + w && pt.y >= t.y && pt.y <= t.y + h;
      });
      if (targetTable && targetTable.id !== connectSource.tableId) {
        showRelationshipDialog(
          connectSource.tableId,
          connectSource.fieldId,
          targetTable.id
        );
      }
      connectSource = null;
      if (tempLine) tempLine.remove();
      tempLine = null;
      render();
    }
    isPanning = false;
    onDocumentDragUp();
  });

  window.addEventListener("mouseup", () => {
    if (connectSource) {
      connectSource = null;
      if (tempLine) tempLine.remove();
      tempLine = null;
      render();
    }
    dragNoteId = null;
    resizeNoteId = null;
  });

  svg.addEventListener("mouseleave", () => {
    isPanning = false;
  });

  svg.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        const dx = (e.clientX - r.left - pan.x) / zoom;
        const dy = (e.clientY - r.top - pan.y) / zoom;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        zoom = Math.max(0.25, Math.min(2, zoom * factor));
        pan.x = e.clientX - r.left - dx * zoom;
        pan.y = e.clientY - r.top - dy * zoom;
        updateTransform();
      }
    },
    { passive: false }
  );

  svg.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const target = e.target as Element;
    const relPath = target.closest("path.relationship-path");
    const tableG = target.closest("g.table-group");
    const fieldRow = target.closest("[data-field-id]");
    const noteEl = target.closest("g.canvas-note");
    if (relPath) {
      const id = (relPath as HTMLElement).dataset.relationshipId!;
      const rel = store.getDiagram().relationships.find((x) => x.id === id);
      if (rel) {
        showContextMenu(e.clientX, e.clientY, [
          {
            label: "Edit",
            fn: () =>
              showRelationshipDialog(
                rel.sourceTableId,
                rel.sourceFieldId,
                rel.targetTableId,
                id
              ),
          },
          {
            label: "Delete",
            danger: true,
            fn: () => {
              store.deleteRelationship(id);
              setSelection(null);
            },
          },
        ]);
      }
    } else if (fieldRow) {
      const tableId = (fieldRow as HTMLElement).dataset.tableId!;
      const fieldId = (fieldRow as HTMLElement).dataset.fieldId!;
      showContextMenu(e.clientX, e.clientY, [
        {
          label: "Edit",
          fn: () => showTableEditor(tableId),
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
      const tableId = tableG.getAttribute("data-table-id");
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
    } else if (noteEl) {
      const noteId = (noteEl as HTMLElement).dataset.noteId;
      if (noteId) {
        const note = store.getDiagram().notes?.find((n) => n.id === noteId);
        if (note) {
          showContextMenu(e.clientX, e.clientY, [
            {
              label: "Edit",
              fn: () => showNoteEditor(note.x, note.y, note.id),
            },
            {
              label: "Delete",
              danger: true,
              fn: () => {
                store.deleteNote(noteId);
                setSelection(null);
              },
            },
          ]);
        }
      }
    } else {
      const pt = screenToDiagram(e.clientX, e.clientY);
      showContextMenu(e.clientX, e.clientY, [
        {
          label: "Add Table",
          fn: () => {
            store.addTable(pt.x, pt.y);
            render();
          },
        },
        {
          label: "Add Note",
          fn: () => showNoteEditor(pt.x, pt.y, null),
        },
      ]);
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
    // Only handle app shortcuts when no modal dialog is open (canvas only)
    const modalOpen = document.querySelector(".modal-overlay");
    if (
      modalOpen &&
      e.ctrlKey &&
      ["z", "y", "s", "t", "o"].includes(e.key.toLowerCase())
    ) {
      return;
    }
    if (e.key === "z" && e.ctrlKey) {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    }
    if (e.key === "y" && e.ctrlKey) {
      e.preventDefault();
      store.redo();
    }
    if (e.key === "s" && e.ctrlKey) {
      e.preventDefault();
      saveDiagram().then((saved) => {
        if (saved) showToast("Saved");
      });
    }
    if (e.key === "t" && e.ctrlKey) {
      e.preventDefault();
      const x = (400 - pan.x) / zoom;
      const y = (200 - pan.y) / zoom;
      store.addTable(x, y);
    }
    if (e.key === "o" && e.ctrlKey) {
      e.preventDefault();
      openDiagramFile();
    }
  });
}

const DELETE_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

function showTableEditor(tableId: string): void {
  const d = store.getDiagram();
  const t = d.tables.find((x) => x.id === tableId);
  if (!t) return;
  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const panel = document.createElement("div");
  panel.className = "modal-panel modal-panel-table-editor";
  const headerDiv = document.createElement("div");
  headerDiv.className = "modal-table-editor-header";
  const title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = "Edit Table";
  headerDiv.appendChild(title);
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Table name";
  nameLabel.htmlFor = "table-editor-name";
  headerDiv.appendChild(nameLabel);
  const nameInput = document.createElement("input");
  nameInput.id = "table-editor-name";
  nameInput.type = "text";
  nameInput.value = t.name;
  nameInput.className = "modal-input";
  headerDiv.appendChild(nameInput);
  panel.appendChild(headerDiv);

  const contentDiv = document.createElement("div");
  contentDiv.className = "modal-table-editor-content";

  const fieldsSection = document.createElement("div");
  fieldsSection.className = "modal-fields-section";
  const fieldsHeading = document.createElement("h3");
  fieldsHeading.textContent = "Fields";
  fieldsSection.appendChild(fieldsHeading);
  const fieldsTable = document.createElement("table");
  fieldsTable.className = "modal-fields-table";
  fieldsTable.innerHTML = `
    <thead><tr>
      <th style="width:24px"></th>
      <th>Name</th>
      <th>Type</th>
      <th style="width:70px">Nullable</th>
      <th style="width:80px">Primary Key</th>
      <th style="width:40px"></th>
    </tr></thead>
    <tbody></tbody>
  `;
  const tbody = fieldsTable.querySelector("tbody")!;
  const rows: {
    id?: string;
    nameInput: HTMLInputElement;
    typeSelect: HTMLSelectElement;
    nullableCb: HTMLInputElement;
    pkCb: HTMLInputElement;
    tr: HTMLTableRowElement;
  }[] = [];
  let fieldDragSrcIndex: number | null = null;

  function addFieldRow(f: {
    id?: string;
    name: string;
    type: string;
    nullable?: boolean;
    primaryKey?: boolean;
  }) {
    const tr = document.createElement("tr");
    tr.draggable = true;
    const dragTd = document.createElement("td");
    dragTd.className = "modal-field-drag";
    dragTd.textContent = "⋮⋮";
    dragTd.title = "Drag to reorder";
    const nameTd = document.createElement("td");
    const nameIn = document.createElement("input");
    nameIn.type = "text";
    nameIn.value = f.name;
    nameIn.placeholder = "Field name";
    nameIn.className = "modal-field-name-input";
    nameTd.appendChild(nameIn);
    const typeTd = document.createElement("td");
    const typeSel = document.createElement("select");
    typeSel.className = "modal-field-type-select";
    FIELD_TYPES.forEach((ft) => {
      const opt = document.createElement("option");
      opt.value = ft;
      opt.textContent = ft;
      if (ft === f.type) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeTd.appendChild(typeSel);
    const nullTd = document.createElement("td");
    const nullableCb = document.createElement("input");
    nullableCb.type = "checkbox";
    nullableCb.checked = f.nullable ?? false;
    nullTd.appendChild(nullableCb);
    const pkTd = document.createElement("td");
    const pkCb = document.createElement("input");
    pkCb.type = "checkbox";
    pkCb.checked = f.primaryKey ?? false;
    pkTd.appendChild(pkCb);
    const delTd = document.createElement("td");
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "modal-field-delete-btn";
    removeBtn.title = "Remove field";
    removeBtn.innerHTML = DELETE_ICON_SVG;
    removeBtn.onclick = () => {
      const idx = rows.findIndex((r) => r.tr === tr);
      if (idx >= 0) rows.splice(idx, 1);
      tr.remove();
    };
    delTd.appendChild(removeBtn);
    tr.appendChild(dragTd);
    tr.appendChild(nameTd);
    tr.appendChild(typeTd);
    tr.appendChild(nullTd);
    tr.appendChild(pkTd);
    tr.appendChild(delTd);
    tbody.appendChild(tr);

    tr.addEventListener("dragstart", (e) => {
      fieldDragSrcIndex = rows.findIndex((r) => r.tr === tr);
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", "");
    });
    tr.addEventListener("dragend", () => {
      fieldDragSrcIndex = null;
    });
    tr.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
    });
    tr.addEventListener("drop", (e) => {
      e.preventDefault();
      const destIndex = rows.findIndex((r) => r.tr === tr);
      if (
        fieldDragSrcIndex === null ||
        destIndex < 0 ||
        fieldDragSrcIndex === destIndex
      )
        return;
      const [removed] = rows.splice(fieldDragSrcIndex, 1);
      rows.splice(destIndex, 0, removed);
      const refTr = rows[destIndex + 1]?.tr ?? null;
      if (refTr) tbody.insertBefore(removed.tr, refTr);
      else tbody.appendChild(removed.tr);
      fieldDragSrcIndex = null;
    });

    const rec = {
      id: f.id,
      nameInput: nameIn,
      typeSelect: typeSel,
      nullableCb,
      pkCb,
      tr,
    };
    rows.push(rec);
    return nameIn;
  }

  t.fields.forEach((f) =>
    addFieldRow({
      id: f.id,
      name: f.name,
      type: f.type,
      nullable: f.nullable,
      primaryKey: f.primaryKey,
    })
  );
  fieldsSection.appendChild(fieldsTable);

  const addFieldPlus = document.createElement("button");
  addFieldPlus.type = "button";
  addFieldPlus.className = "modal-add-field-plus";
  addFieldPlus.textContent = "+";
  addFieldPlus.title = "Add field";
  addFieldPlus.onclick = () => {
    const newNameInput = addFieldRow({
      name: "field",
      type: "text",
      nullable: false,
      primaryKey: false,
    });
    requestAnimationFrame(() => newNameInput.focus());
  };
  fieldsSection.appendChild(addFieldPlus);
  contentDiv.appendChild(fieldsSection);

  const relSection = document.createElement("div");
  relSection.className = "modal-relationships-section";
  const relHeading = document.createElement("h3");
  relHeading.textContent = "Relationships";
  relSection.appendChild(relHeading);
  const relContainer = document.createElement("div");

  function renderRelationships(): void {
    relContainer.innerHTML = "";
    const diagram = store.getDiagram();
    const rels = diagram.relationships.filter(
      (r) => r.sourceTableId === tableId || r.targetTableId === tableId
    );
    const currentTable = diagram.tables.find((x) => x.id === tableId)!;

    rels.forEach((r) => {
      const otherTableId =
        r.sourceTableId === tableId ? r.targetTableId : r.sourceTableId;
      const otherT = diagram.tables.find((x) => x.id === otherTableId);
      if (!otherT) return;
      const otherTable = otherT;
      const weAreSource = r.sourceTableId === tableId;
      const card = document.createElement("div");
      card.className = "modal-relationship-card";
      const cardHeader = document.createElement("div");
      cardHeader.className = "modal-relationship-card-header";
      const targetLabel = document.createElement("div");
      targetLabel.className = "rel-target-name";
      targetLabel.textContent = weAreSource
        ? `Foreign: ${otherTable.name}`
        : `Primary: ${otherTable.name}`;
      cardHeader.appendChild(targetLabel);
      const deleteRelBtn = document.createElement("button");
      deleteRelBtn.type = "button";
      deleteRelBtn.className =
        "modal-field-delete-btn modal-relationship-delete";
      deleteRelBtn.title = "Delete relationship";
      deleteRelBtn.innerHTML = DELETE_ICON_SVG;
      deleteRelBtn.onclick = () => {
        store.deleteRelationship(r.id);
        renderRelationships();
      };
      cardHeader.appendChild(deleteRelBtn);
      card.appendChild(cardHeader);
      const srcIds = r.sourceFieldIds?.length
        ? r.sourceFieldIds
        : [r.sourceFieldId];
      const tgtIds = r.targetFieldIds?.length
        ? r.targetFieldIds
        : [r.targetFieldId];
      const mapTable = document.createElement("table");
      mapTable.className = "modal-relationship-table";
      mapTable.innerHTML =
        "<thead><tr><th>Source Field</th><th>Target Field</th><th></th></tr></thead><tbody></tbody>";
      const mapTbody = mapTable.querySelector("tbody")!;

      function updateRelFromRows(): void {
        const srcSelects = mapTbody.querySelectorAll<HTMLSelectElement>(
          "tr select.src-field"
        );
        const tgtSelects = mapTbody.querySelectorAll<HTMLSelectElement>(
          "tr select.tgt-field"
        );
        const newSrcIds: string[] = [];
        const newTgtIds: string[] = [];
        srcSelects.forEach((sel, i) => {
          const tgtSel = tgtSelects[i];
          const sid = sel.value;
          const tid = tgtSel?.value ?? "";
          if (sid && tid) {
            newSrcIds.push(sid);
            newTgtIds.push(tid);
          }
        });
        if (newSrcIds.length === 0 || newTgtIds.length === 0) return;
        store.updateRelationshipMeta(r.id, newSrcIds, newTgtIds);
      }

      function addMapRow(srcFieldId: string, tgtFieldId: string): void {
        const tr = document.createElement("tr");
        const srcTd = document.createElement("td");
        const srcSel = document.createElement("select");
        srcSel.className = "src-field";
        const srcFields = weAreSource ? currentTable.fields : otherTable.fields;
        srcFields.forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f.id;
          opt.textContent = f.name;
          if (f.id === srcFieldId) opt.selected = true;
          srcSel.appendChild(opt);
        });
        srcSel.onchange = () => updateRelFromRows();
        srcTd.appendChild(srcSel);
        const tgtTd = document.createElement("td");
        const tgtSel = document.createElement("select");
        tgtSel.className = "tgt-field";
        const tgtFields = weAreSource ? otherTable.fields : currentTable.fields;
        tgtFields.forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f.id;
          opt.textContent = f.name;
          if (f.id === tgtFieldId) opt.selected = true;
          tgtSel.appendChild(opt);
        });
        tgtSel.onchange = () => updateRelFromRows();
        tgtTd.appendChild(tgtSel);
        const delTd = document.createElement("td");
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "modal-field-delete-btn";
        delBtn.innerHTML = DELETE_ICON_SVG;
        delBtn.title = "Remove mapping";
        delBtn.onclick = () => {
          tr.remove();
          updateRelFromRows();
        };
        delTd.appendChild(delBtn);
        tr.appendChild(srcTd);
        tr.appendChild(tgtTd);
        tr.appendChild(delTd);
        mapTbody.appendChild(tr);
      }

      for (let i = 0; i < Math.max(srcIds.length, 1); i++) {
        addMapRow(
          srcIds[i] ?? currentTable.fields[0]?.id ?? "",
          tgtIds[i] ?? otherTable.fields[0]?.id ?? ""
        );
      }

      card.appendChild(mapTable);
      const addRowBtn = document.createElement("button");
      addRowBtn.type = "button";
      addRowBtn.className = "modal-add-rel-row";
      addRowBtn.textContent = "Add Field";
      addRowBtn.onclick = () => {
        const srcId = weAreSource
          ? currentTable.fields[0]?.id ?? ""
          : otherTable.fields[0]?.id ?? "";
        const tgtId = weAreSource
          ? otherTable.fields[0]?.id ?? ""
          : currentTable.fields[0]?.id ?? "";
        addMapRow(srcId, tgtId);
      };
      card.appendChild(addRowBtn);
      relContainer.appendChild(card);
    });

    const addBlock = document.createElement("div");
    addBlock.className = "modal-add-relationship-block";
    const roleSelect = document.createElement("select");
    roleSelect.innerHTML =
      '<option value="source">This table is Primary</option><option value="target">This table is Foreign</option>';
    const tableSelect = document.createElement("select");
    diagram.tables
      .filter((x) => x.id !== tableId)
      .forEach((tab) => {
        const opt = document.createElement("option");
        opt.value = tab.id;
        opt.textContent = tab.name;
        tableSelect.appendChild(opt);
      });
    const srcFieldSelect = document.createElement("select");
    currentTable.fields.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      srcFieldSelect.appendChild(opt);
    });
    const tgtFieldSelect = document.createElement("select");
    function updateTgtFieldOptions(): void {
      const otherId = tableSelect.value;
      const other = diagram.tables.find((x) => x.id === otherId);
      tgtFieldSelect.innerHTML = "";
      if (other) {
        other.fields.forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f.id;
          opt.textContent = f.name;
          tgtFieldSelect.appendChild(opt);
        });
      }
    }
    tableSelect.onchange = updateTgtFieldOptions;
    updateTgtFieldOptions();
    addBlock.appendChild(roleSelect);
    addBlock.appendChild(tableSelect);
    addBlock.appendChild(document.createTextNode(" "));
    addBlock.appendChild(srcFieldSelect);
    addBlock.appendChild(tgtFieldSelect);
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "create-rel-btn";
    createBtn.textContent = "Add";
    createBtn.onclick = () => {
      const otherId = tableSelect.value;
      const role = roleSelect.value as "source" | "target";
      const srcF = srcFieldSelect.value;
      const tgtF = tgtFieldSelect.value;
      if (!otherId || !srcF || !tgtF) return;
      const sourceTableId = role === "source" ? tableId : otherId;
      const targetTableId = role === "source" ? otherId : tableId;
      const sourceFieldId = role === "source" ? srcF : tgtF;
      const targetFieldId = role === "source" ? tgtF : srcF;
      store.addRelationshipWithMeta(
        sourceTableId,
        [sourceFieldId],
        targetTableId,
        [targetFieldId]
      );
      renderRelationships();
    };
    addBlock.appendChild(createBtn);
    relContainer.appendChild(addBlock);
  }

  renderRelationships();
  relSection.appendChild(relContainer);
  contentDiv.appendChild(relSection);
  panel.appendChild(contentDiv);

  const footerDiv = document.createElement("div");
  footerDiv.className = "modal-table-editor-footer";
  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.textContent = "OK";
  okBtn.onclick = () => {
    const name = nameInput.value.trim() || t.name;
    const fields = rows.map((r) => ({
      id: r.id,
      name: r.nameInput.value.trim() || "field",
      type: r.typeSelect.value,
      nullable: r.nullableCb.checked,
      primaryKey: r.pkCb.checked,
    }));
    store.replaceTableContent(tableId, name, fields);
    overlay.remove();
    render();
  };
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => overlay.remove();
  footerDiv.appendChild(okBtn);
  footerDiv.appendChild(cancelBtn);
  panel.appendChild(footerDiv);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function showRelationshipDialog(
  sourceTableId: string,
  sourceFieldId: string,
  targetTableId: string,
  relationshipId?: string
): void {
  hideRelationshipTooltip();
  const d = store.getDiagram();
  const srcT = d.tables.find((t) => t.id === sourceTableId);
  const tgtT = d.tables.find((t) => t.id === targetTableId);
  if (!srcT || !tgtT) return;
  const srcTable = srcT;
  const tgtTable = tgtT;
  const existingRel = relationshipId
    ? d.relationships.find((x) => x.id === relationshipId)
    : null;
  const srcFieldIds = existingRel?.sourceFieldIds?.length
    ? [...existingRel.sourceFieldIds]
    : [sourceFieldId];
  const tgtFieldIds = existingRel?.targetFieldIds?.length
    ? [...existingRel.targetFieldIds]
    : [existingRel?.targetFieldId ?? tgtTable.fields[0]?.id ?? ""];
  while (srcFieldIds.length < tgtFieldIds.length)
    srcFieldIds.push(srcTable.fields[0]?.id ?? "");
  while (tgtFieldIds.length < srcFieldIds.length)
    tgtFieldIds.push(tgtTable.fields[0]?.id ?? "");

  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const panel = document.createElement("div");
  panel.className = "modal-panel modal-panel-relationship";

  const headerDiv = document.createElement("div");
  headerDiv.className = "modal-relationship-editor-header";
  const title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = relationshipId ? "Edit Relationship" : "New Relationship";
  headerDiv.appendChild(title);
  const fromToWrap = document.createElement("div");
  fromToWrap.className = "modal-relationship-from-to";
  const srcLabel = document.createElement("div");
  srcLabel.className = "modal-readonly modal-relationship-from-to-row";
  const srcPrefix = document.createElement("span");
  srcPrefix.className = "modal-relationship-from-to-label";
  srcPrefix.textContent = "From:";
  srcLabel.appendChild(srcPrefix);
  srcLabel.appendChild(document.createTextNode(" " + srcTable.name));
  fromToWrap.appendChild(srcLabel);
  const tgtLabel = document.createElement("div");
  tgtLabel.className = "modal-readonly modal-relationship-from-to-row";
  const tgtPrefix = document.createElement("span");
  tgtPrefix.className = "modal-relationship-from-to-label";
  tgtPrefix.textContent = "To:";
  tgtLabel.appendChild(tgtPrefix);
  tgtLabel.appendChild(document.createTextNode(" " + tgtTable.name));
  fromToWrap.appendChild(tgtLabel);
  headerDiv.appendChild(fromToWrap);
  panel.appendChild(headerDiv);

  const contentDiv = document.createElement("div");
  contentDiv.className = "modal-relationship-editor-content";

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Relationship name";
  contentDiv.appendChild(nameLabel);
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Optional";
  nameInput.className = "modal-input";
  nameInput.value = existingRel?.name ?? "";
  contentDiv.appendChild(nameInput);

  const cardLabel = document.createElement("label");
  cardLabel.textContent = "Cardinality";
  cardLabel.style.display = "block";
  cardLabel.style.marginTop = "0.75rem";
  contentDiv.appendChild(cardLabel);
  const cardSelect = document.createElement("select");
  cardSelect.className = "modal-input";
  CARDINALITY_OPTIONS.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    if (existingRel?.cardinality === c) opt.selected = true;
    cardSelect.appendChild(opt);
  });
  contentDiv.appendChild(cardSelect);

  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Note";
  noteLabel.style.display = "block";
  noteLabel.style.marginTop = "0.75rem";
  contentDiv.appendChild(noteLabel);
  const noteInput = document.createElement("textarea");
  noteInput.placeholder = "Optional";
  noteInput.className = "modal-input modal-textarea";
  noteInput.rows = 2;
  noteInput.value = existingRel?.note ?? "";
  contentDiv.appendChild(noteInput);

  const fieldsSection = document.createElement("div");
  fieldsSection.className = "modal-rel-fields-section";
  const fieldsHeading = document.createElement("h3");
  fieldsHeading.textContent = "Fields";
  fieldsSection.appendChild(fieldsHeading);
  const fieldsTable = document.createElement("table");
  fieldsTable.className = "modal-rel-fields-table";
  fieldsTable.innerHTML =
    '<thead><tr><th>Primary Fields</th><th>Foreign Key Fields</th><th style="width:40px"></th></tr></thead><tbody></tbody>';
  const fieldTbody = fieldsTable.querySelector("tbody")!;
  const fieldRows: {
    primarySel: HTMLSelectElement;
    foreignSel: HTMLSelectElement;
    tr: HTMLTableRowElement;
  }[] = [];

  function addFieldPairRow(
    primaryFieldId: string,
    foreignFieldId: string
  ): void {
    const tr = document.createElement("tr");
    const primaryTd = document.createElement("td");
    const primarySel = document.createElement("select");
    srcTable.fields.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      if (f.id === primaryFieldId) opt.selected = true;
      primarySel.appendChild(opt);
    });
    primaryTd.appendChild(primarySel);
    const foreignTd = document.createElement("td");
    const foreignSel = document.createElement("select");
    tgtTable.fields.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      if (f.id === foreignFieldId) opt.selected = true;
      foreignSel.appendChild(opt);
    });
    foreignTd.appendChild(foreignSel);
    const delTd = document.createElement("td");
    delTd.className = "modal-rel-delete-cell";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "modal-field-delete-btn";
    delBtn.title = "Remove field pair";
    delBtn.innerHTML = DELETE_ICON_SVG;
    delBtn.onclick = () => {
      const idx = fieldRows.findIndex((r) => r.tr === tr);
      if (idx >= 0) fieldRows.splice(idx, 1);
      tr.remove();
    };
    delTd.appendChild(delBtn);
    tr.appendChild(primaryTd);
    tr.appendChild(foreignTd);
    tr.appendChild(delTd);
    fieldTbody.appendChild(tr);
    fieldRows.push({ primarySel, foreignSel, tr });
  }

  for (let i = 0; i < Math.max(srcFieldIds.length, 1); i++) {
    addFieldPairRow(
      srcFieldIds[i] ?? srcT.fields[0]?.id ?? "",
      tgtFieldIds[i] ?? tgtT.fields[0]?.id ?? ""
    );
  }

  fieldsSection.appendChild(fieldsTable);
  const addFieldPlus = document.createElement("button");
  addFieldPlus.type = "button";
  addFieldPlus.className = "modal-rel-add-field-plus";
  addFieldPlus.textContent = "+";
  addFieldPlus.title = "Add field pair";
  addFieldPlus.onclick = () => {
    addFieldPairRow(srcTable.fields[0]?.id ?? "", tgtTable.fields[0]?.id ?? "");
  };
  fieldsSection.appendChild(addFieldPlus);
  contentDiv.appendChild(fieldsSection);
  panel.appendChild(contentDiv);

  const footerDiv = document.createElement("div");
  footerDiv.className = "modal-relationship-editor-footer";
  if (relationshipId) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.className = "modal-relationship-delete-btn";
    deleteBtn.onclick = () => {
      store.deleteRelationship(relationshipId);
      overlay.remove();
      render();
    };
    footerDiv.appendChild(deleteBtn);
  }
  const footerRight = document.createElement("div");
  footerRight.className = "modal-relationship-editor-footer-buttons";
  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.textContent = "OK";
  okBtn.onclick = () => {
    const newSourceFieldIds = fieldRows
      .map((r) => r.primarySel.value)
      .filter(Boolean);
    const newTargetFieldIds = fieldRows
      .map((r) => r.foreignSel.value)
      .filter(Boolean);
    if (newSourceFieldIds.length === 0 || newTargetFieldIds.length === 0) {
      showToast("Add at least one primary and one foreign field");
      return;
    }
    if (relationshipId) {
      store.updateRelationshipMeta(
        relationshipId,
        newSourceFieldIds,
        newTargetFieldIds,
        nameInput.value.trim() || undefined,
        noteInput.value.trim() || undefined,
        cardSelect.value || undefined
      );
    } else {
      store.addRelationshipWithMeta(
        sourceTableId,
        newSourceFieldIds,
        targetTableId,
        newTargetFieldIds,
        nameInput.value.trim() || undefined,
        noteInput.value.trim() || undefined,
        cardSelect.value || undefined
      );
    }
    overlay.remove();
    render();
  };
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => overlay.remove();
  footerRight.appendChild(okBtn);
  footerRight.appendChild(cancelBtn);
  footerDiv.appendChild(footerRight);
  panel.appendChild(footerDiv);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function showNoteEditor(
  canvasX: number,
  canvasY: number,
  noteId: string | null
): void {
  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const panel = document.createElement("div");
  panel.className = "modal-panel modal-panel-note-editor";
  const headerDiv = document.createElement("div");
  headerDiv.className = "modal-header";
  const title = document.createElement("h2");
  title.textContent = noteId ? "Edit Note" : "New Note";
  headerDiv.appendChild(title);
  panel.appendChild(headerDiv);
  const contentDiv = document.createElement("div");
  contentDiv.className = "modal-note-editor-content";
  const textarea = document.createElement("textarea");
  textarea.className = "modal-input modal-textarea";
  textarea.rows = 8;
  textarea.placeholder = "Enter note text...";
  if (noteId) {
    const note = store.getDiagram().notes?.find((n) => n.id === noteId);
    if (note) textarea.value = note.text;
  }
  contentDiv.appendChild(textarea);
  panel.appendChild(contentDiv);
  const footerDiv = document.createElement("div");
  footerDiv.className = "modal-note-editor-footer";
  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.textContent = "OK";
  okBtn.onclick = () => {
    const text = textarea.value.trim();
    if (noteId) {
      store.updateNote(noteId, text);
    } else {
      store.addNote(canvasX, canvasY, text);
    }
    overlay.remove();
    render();
  };
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => overlay.remove();
  footerDiv.appendChild(okBtn);
  footerDiv.appendChild(cancelBtn);
  panel.appendChild(footerDiv);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function showContextMenu(
  x: number,
  y: number,
  items: { label: string; danger?: boolean; fn: () => void }[]
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
    0
  );
}

export function init(el: HTMLElement): void {
  container = el;
  store = new Store();
  container.innerHTML = "";
  setupToolbar();
  setupCanvas();
  render();
  appendStatus("Ready. Use Import/Export from the toolbar.");
}
