import type {
  Diagram,
  Table,
  Field,
  Relationship,
  Selection,
  RecentEntry,
  WorkspaceConfig,
  CatalogTable,
  CatalogRelationship,
  WorkspaceUIState,
  TableCatalog,
} from "./types";
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
let statusContextEl: HTMLElement | null = null;
const DEFAULT_STATUS_HEIGHT = 120;
const COLLAPSED_STATUS_HEIGHT = 28;
let statusPanelHeight = DEFAULT_STATUS_HEIGHT;
let statusPanelCollapsed = false;
let currentFilePath: string | null = null;
/** Unsubscribe from the previously active store when switching tabs/workspace. */
let unsubscribeStore: (() => void) | null = null;
/** Re-bind store subscription (call after bindActiveTab so render/undo/redo track the active store). */
let bindStoreSubscription: (() => void) | null = null;
/** Pending auto-save timeout; cleared when switching tabs or when save runs. */
let autoSaveTimeoutId: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY_MS = 5000;

/** Inline SVG for trash/delete icon (16×16). */
const TRASH_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

// --- App shell (landing vs editor, tabs) ---
type ViewMode = "landing" | "editor";
const WORKSPACE_CONFIG_FILE = "workspace.config.json";
const TABLE_CATALOG_FILE = "table_catalog.json";
const CATALOG_RELATIONSHIPS_FILE = "catalog_relationships.json";
const WORKSPACE_STATE_FILE = "workspace.state";

type DiagramDoc = {
  type: "diagram";
  id: string;
  label: string;
  store: Store;
  path: string | null;
};
type InnerDiagramTab = {
  id: string;
  label: string;
  store: Store;
  path: string; // full path under workspace root
};
type WorkspaceDoc = {
  type: "workspace";
  id: string;
  label: string;
  rootPath: string;
  name: string;
  description?: string;
  catalogTables: CatalogTable[];
  catalogRelationships: CatalogRelationship[];
  innerDiagramTabs: InnerDiagramTab[];
  activeInnerDiagramIndex: number;
  /** When true, save diagrams automatically. */
  autoSaveDiagrams?: boolean;
  /** Sidebar accordion open state and scroll; persisted in workspace.state. */
  workspaceUIState?: WorkspaceUIState;
};
type Doc = DiagramDoc | WorkspaceDoc;
const RECENT_KEY = "schemastudio-recent";
const RECENT_MAX = 6;

let rootContainer: HTMLElement;
let viewMode: ViewMode = "landing";
let documents: Doc[] = [];
let activeDocIndex = -1;
/** When set, workspace is the full app focus (no workspace tab); when null, documents are standalone diagram tabs. */
let currentWorkspace: WorkspaceDoc | null = null;
let editorInitialized = false;
let editorContentEl: HTMLElement | null = null;
let tabStripEl: HTMLElement | null = null;
let menuBarEl: HTMLElement | null = null;

function nextDocId(): string {
  return "doc-" + Math.random().toString(36).slice(2, 11);
}

function getRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function setRecent(entries: RecentEntry[]): void {
  try {
    const sorted = [...entries].sort((a, b) => b.lastOpened - a.lastOpened);
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(sorted.slice(0, RECENT_MAX))
    );
  } catch (_) {}
}

function addRecent(
  entry: Omit<RecentEntry, "lastOpened"> & { lastOpened?: number }
): void {
  const now = Date.now();
  const full: RecentEntry = { ...entry, lastOpened: entry.lastOpened ?? now };
  const entries = getRecent().filter((e) => e.path !== full.path);
  entries.unshift(full);
  setRecent(entries);
}

function getActiveDoc(): Doc | null {
  if (currentWorkspace) return currentWorkspace;
  if (activeDocIndex < 0 || activeDocIndex >= documents.length) return null;
  return documents[activeDocIndex] ?? null;
}

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
      e.preventDefault(); // prevent text selection so table drag works
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
    const doc = getActiveDoc();
    if (doc?.type === "workspace") {
      const w = doc as WorkspaceDoc;
      await syncDiagramRelationshipsToCatalog(w, store.getDiagram());
    }
    await bridge.saveFile(path, JSON.stringify(store.getDiagram()));
    store.clearDirty();
    if (doc && doc.type === "diagram") {
      (doc as DiagramDoc).path = path;
      (doc as DiagramDoc).label = path.split(/[/\\]/).pop() ?? "Untitled";
      addRecent({
        path,
        kind: "diagram",
        label: (doc as DiagramDoc).label,
        lastOpened: Date.now(),
      });
      refreshTabStrip();
    } else if (doc && doc.type === "workspace") {
      refreshTabStrip();
      if (workspacePanelEl) renderWorkspaceView();
    }
    appendStatus(`Saved ${path}`);
    return true;
  } catch (e) {
    showToast("Save failed: " + (e as Error).message);
    return false;
  }
}

/** Save current diagram to a new path (Save As). Returns true if saved. */
async function saveDiagramAs(): Promise<boolean> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return false;
  }
  const defaultName = currentFilePath?.split(/[/\\]/).pop() ?? "schema.diagram";
  let path: string;
  try {
    path = await bridge.saveFileDialog(
      "Save diagram as",
      defaultName,
      "Diagram",
      "*.diagram"
    );
  } catch (e) {
    showToast("Save failed: " + (e as Error).message);
    return false;
  }
  if (!path) return false;
  try {
    const doc = getActiveDoc();
    if (doc?.type === "workspace") {
      const w = doc as WorkspaceDoc;
      await syncDiagramRelationshipsToCatalog(w, store.getDiagram());
    }
    await bridge.saveFile(path, JSON.stringify(store.getDiagram()));
    store.clearDirty();
    currentFilePath = path;
    if (doc && doc.type === "diagram") {
      (doc as DiagramDoc).path = path;
      (doc as DiagramDoc).label = path.split(/[/\\]/).pop() ?? "Untitled";
      addRecent({
        path,
        kind: "diagram",
        label: (doc as DiagramDoc).label,
        lastOpened: Date.now(),
      });
      refreshTabStrip();
    } else if (doc && doc.type === "workspace") {
      const w = doc as WorkspaceDoc;
      const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
      if (inner) {
        inner.path = path;
        inner.label =
          path
            .split(/[/\\]/)
            .pop()
            ?.replace(/\.diagram$/i, "") ?? "Diagram";
        refreshTabStrip();
        renderWorkspaceView();
      }
    }
    appendStatus(`Saved as ${path}`);
    showToast("Saved");
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
  newBtn.textContent = "Add Table";
  newBtn.title = "Add table to diagram";
  newBtn.onclick = () => addTableFromToolbar();
  toolbar.appendChild(newBtn);

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.title = "Save diagram";
  saveBtn.onclick = async () => {
    const saved = await saveDiagram();
    if (saved) showToast("Saved");
  };
  toolbar.appendChild(saveBtn);

  const saveAsBtn = document.createElement("button");
  saveAsBtn.textContent = "Save As…";
  saveAsBtn.title = "Save diagram to a new file";
  saveAsBtn.onclick = async () => {
    const saved = await saveDiagramAs();
    if (saved) showToast("Saved");
  };
  toolbar.appendChild(saveAsBtn);

  const undoBtn = document.createElement("button");
  undoBtn.textContent = "Undo";
  undoBtn.onclick = () => store.undo();
  toolbar.appendChild(undoBtn);

  const redoBtn = document.createElement("button");
  redoBtn.textContent = "Redo";
  redoBtn.onclick = () => store.redo();
  toolbar.appendChild(redoBtn);

  const themeBtn = document.createElement("button");
  themeBtn.className = "toolbar-theme-btn";
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

  bindStoreSubscription = () => {
    if (unsubscribeStore) {
      unsubscribeStore();
      unsubscribeStore = null;
    }
    if (autoSaveTimeoutId) {
      clearTimeout(autoSaveTimeoutId);
      autoSaveTimeoutId = null;
    }
    unsubscribeStore = store.subscribe(() => {
      undoBtn.disabled = !store.canUndo();
      redoBtn.disabled = !store.canRedo();
      render();
      const doc = getActiveDoc();
      if (doc?.type === "workspace" && workspacePanelEl) {
        const w = doc as WorkspaceDoc;
        const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
        if (inner && inner.store === store) updateWorkspaceInnerTabLabels();
      }
      if (
        doc?.type === "workspace" &&
        (doc as WorkspaceDoc).autoSaveDiagrams &&
        store.isDirty()
      ) {
        const w = doc as WorkspaceDoc;
        const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
        if (inner && inner.store === store) {
          if (autoSaveTimeoutId) clearTimeout(autoSaveTimeoutId);
          autoSaveTimeoutId = setTimeout(() => {
            autoSaveTimeoutId = null;
            syncDiagramRelationshipsToCatalog(w, store.getDiagram())
              .then(() =>
                bridge.saveFile(inner.path, JSON.stringify(store.getDiagram()))
              )
              .then(() => {
                store.clearDirty();
                refreshTabStrip();
                if (workspacePanelEl) renderWorkspaceView();
                appendStatus("Auto-saved");
              })
              .catch(() => showToast("Auto-save failed"));
          }, AUTO_SAVE_DELAY_MS);
        }
      }
    });
  };
  bindStoreSubscription();

  document.body.addEventListener("click", (e) => {
    if (!(e.target as Element).closest(".dropdown")) {
      rootContainer
        .querySelectorAll(".toolbar .dropdown.open")
        .forEach((el) => {
          el.classList.remove("open");
        });
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
      specifySchemaToggle.setAttribute("aria-pressed", String(specifySchemaOn));
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
      useCreationModeToggle.classList.toggle(
        "modal-toggle-on",
        useCreationModeOn
      );
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
    const importSource = path.replace(/^.*[/\\]/, "") || "import.sql";
    const json = await bridge.importSQL(raw, importSource);
    const catalog = JSON.parse(json) as TableCatalog;
    const tables = catalog?.tables ?? [];
    const relationships = catalog?.relationships ?? [];
    const doc = getActiveDoc();
    if (doc?.type === "workspace") {
      const w = doc as WorkspaceDoc;
      for (const table of tables) {
        const catalogId = nextCatalogId();
        w.catalogTables.push({
          id: catalogId,
          name: table.name,
          fields: table.fields.map((f) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            nullable: f.nullable,
            primaryKey: f.primaryKey,
          })),
        });
      }
      await saveTableCatalog(w.rootPath, w.catalogTables);
      bindActiveTab();
      refreshTabStrip();
      updateEditorContentVisibility();
      renderWorkspaceView();
      appendStatus(`Imported SQL to catalog: ${catalog.tables.length} tables`);
      showToast("Imported SQL to catalog");
    } else {
      const d: Diagram = {
        version: 1,
        tables,
        relationships,
      };
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
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendStatus(`SQL import failed: ${msg}`, "error");
    showToast("Import failed");
  }
}

async function openAndImportCSV(): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return;
  }
  const path = await bridge.openFileDialog("Open CSV", "CSV", "*.csv");
  if (!path) return;
  try {
    const raw = await bridge.loadFile(path);
    const importSource = path.replace(/^.*[/\\]/, "") || "import.csv";
    const json = await bridge.importCSV(raw, importSource);
    const catalog = JSON.parse(json) as TableCatalog;
    const tables = catalog?.tables ?? [];
    const relationships = catalog?.relationships ?? [];
    const doc = getActiveDoc();
    if (doc?.type === "workspace") {
      const w = doc as WorkspaceDoc;
      for (const table of tables) {
        const catalogId = nextCatalogId();
        w.catalogTables.push({
          id: catalogId,
          name: table.name,
          fields: table.fields.map((f) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            nullable: f.nullable,
            primaryKey: f.primaryKey,
          })),
        });
      }
      await saveTableCatalog(w.rootPath, w.catalogTables);
      bindActiveTab();
      refreshTabStrip();
      updateEditorContentVisibility();
      renderWorkspaceView();
      appendStatus(`Imported CSV to catalog: ${catalog.tables.length} tables`);
      showToast("Imported CSV to catalog");
    } else {
      const d: Diagram = {
        version: 1,
        tables,
        relationships,
      };
      store.setDiagram(d);
      appendStatus(`Imported CSV from ${path}: ${d.tables.length} tables`);
      if (d.tables.length === 0) {
        appendStatus(
          "No tables found. CSV must have columns: schema, table, column, type, is_nullable, field_order.",
          "error"
        );
        showToast("No tables found — check Status panel for expected format");
      } else {
        showToast("Imported CSV");
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendStatus(`CSV import failed: ${msg}`, "error");
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
  const contextDiv = document.createElement("div");
  contextDiv.className = "status-panel-context";
  statusContextEl = contextDiv;
  panel.appendChild(contextDiv);
  const content = document.createElement("div");
  content.className = "status-panel-content";
  statusPanelContent = content;
  panel.appendChild(content);
  container.appendChild(panel);
}

function updateStatusContext(): void {
  if (!statusContextEl) return;
  const doc = getActiveDoc();
  const parts: string[] = [];
  if (doc?.type === "workspace") {
    const w = doc as WorkspaceDoc;
    parts.push(`Workspace: ${w.name}`);
    const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
    if (inner) {
      const name = inner.path.split(/[/\\]/).pop() ?? inner.label;
      parts.push(`Diagram: ${name}`);
    }
  } else if (doc?.type === "diagram") {
    const label = (doc as DiagramDoc).path
      ? (doc as DiagramDoc).path.split(/[/\\]/).pop() ??
        (doc as DiagramDoc).label
      : (doc as DiagramDoc).label;
    parts.push(`Diagram: ${label}`);
  }
  statusContextEl.textContent = parts.length > 0 ? parts.join(" | ") : "";
}

function updateMenuState(): void {
  const doc = getActiveDoc();
  const closeDiagramEl = rootContainer?.querySelector(
    '[data-menu-action="close-diagram"]'
  ) as HTMLButtonElement | null;
  const closeWorkspaceEl = rootContainer?.querySelector(
    '[data-menu-action="close-workspace"]'
  ) as HTMLButtonElement | null;
  const workspaceSettingsEl = rootContainer?.querySelector(
    '[data-menu-action="workspace-settings"]'
  ) as HTMLButtonElement | null;
  if (closeDiagramEl) {
    closeDiagramEl.disabled =
      !doc ||
      (doc.type === "workspace" &&
        (doc as WorkspaceDoc).innerDiagramTabs.length === 0);
  }
  if (closeWorkspaceEl) {
    closeWorkspaceEl.disabled = doc?.type !== "workspace";
  }
  if (workspaceSettingsEl) {
    workspaceSettingsEl.disabled = doc?.type !== "workspace";
  }
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

  svg.addEventListener("dragover", (e) => {
    const hasCatalog = e.dataTransfer?.types?.some(
      (t) => t.toLowerCase() === "catalogtableid"
    );
    if (hasCatalog) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
  });
  svg.addEventListener("drop", (e) => {
    const catalogId = e.dataTransfer?.getData("catalogTableId");
    if (!catalogId) return;
    e.preventDefault();
    const doc = getActiveDoc();
    if (doc?.type !== "workspace") return;
    const w = doc as WorkspaceDoc;
    const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
    if (!inner) return;
    const catalogEntry = w.catalogTables.find((c) => c.id === catalogId);
    if (!catalogEntry) return;
    const pt = screenToDiagram(e.clientX, e.clientY);
    const newTable = inner.store.addTableWithContent(
      pt.x,
      pt.y,
      catalogEntry.name,
      catalogEntry.fields.map((f) => ({
        name: f.name,
        type: f.type,
        nullable: f.nullable,
        primaryKey: f.primaryKey,
      })),
      catalogId
    );
    createDiagramRelationshipsFromCatalog(w, inner, catalogId, newTable);
    render();
    appendStatus(`Added ${catalogEntry.name} from catalog`);
  });

  svg.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("g.canvas-note")) return;
    const closestTable = (e.target as Element).closest("g.table-group");
    if (
      e.target === svg ||
      (closestTable === null &&
        !(e.target as Element).closest("path.relationship-path"))
    ) {
      if (!closestTable) {
        setSelection(null);
      }
      if (!closestTable) {
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
              const rel = store
                .getDiagram()
                .relationships.find((r) => r.id === id);
              store.deleteRelationship(id);
              setSelection(null);
              if (rel) {
                const doc = getActiveDoc();
                if (doc?.type === "workspace")
                  syncRelationshipRemovalFromCatalog(
                    doc as WorkspaceDoc,
                    rel
                  ).then(() => {});
              }
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
          fn: () => addTableToCurrentDiagram(pt.x, pt.y),
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
      if (selection.type === "relationship") {
        const rel = store
          .getDiagram()
          .relationships.find((r) => r.id === selection.relationshipId);
        store.deleteRelationship(selection.relationshipId);
        if (rel) {
          const doc = getActiveDoc();
          if (doc?.type === "workspace")
            syncRelationshipRemovalFromCatalog(doc as WorkspaceDoc, rel).then(
              () => {}
            );
        }
      }
      if (
        selection.type === "table" ||
        selection.type === "field" ||
        selection.type === "relationship"
      )
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
      addTableToCurrentDiagram(x, y);
    }
    if (e.key === "o" && e.ctrlKey) {
      e.preventDefault();
      openDiagramTab();
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
        const doc = getActiveDoc();
        if (doc?.type === "workspace" && r.catalogRelationshipId)
          syncRelationshipRemovalFromCatalog(doc as WorkspaceDoc, r).then(
            () => {}
          );
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
  const doc = getActiveDoc();
  if (doc?.type === "workspace" && t.catalogTableId) {
    const syncBtn = document.createElement("button");
    syncBtn.type = "button";
    syncBtn.className = "modal-table-editor-sync-btn";
    syncBtn.textContent = "Sync to Catalog";
    syncBtn.onclick = async () => {
      const w = doc as WorkspaceDoc;
      const catalogEntry = w.catalogTables.find(
        (c) => c.id === t.catalogTableId
      );
      if (!catalogEntry) {
        showToast("Catalog entry not found");
        return;
      }
      const name = nameInput.value.trim() || t.name;
      const fields = rows.map((r) => ({
        id: r.id,
        name: r.nameInput.value.trim() || "field",
        type: r.typeSelect.value,
        nullable: r.nullableCb.checked,
        primaryKey: r.pkCb.checked,
      }));
      catalogEntry.name = name;
      catalogEntry.fields = fields.map((f, i) => ({
        id: catalogEntry.fields[i]?.id ?? nextFieldId(),
        name: f.name,
        type: f.type,
        nullable: f.nullable,
        primaryKey: f.primaryKey,
      }));
      const diagram = store.getDiagram();
      const relsForTable = (diagram.relationships ?? []).filter(
        (r) => r.sourceTableId === tableId || r.targetTableId === tableId
      );
      let catalogChanged = false;
      for (const rel of relsForTable) {
        const srcT = diagram.tables.find((x) => x.id === rel.sourceTableId);
        const tgtT = diagram.tables.find((x) => x.id === rel.targetTableId);
        if (!srcT?.catalogTableId || !tgtT?.catalogTableId) continue;
        const srcField = srcT.fields.find(
          (f) => f.id === (rel.sourceFieldIds?.[0] ?? rel.sourceFieldId)
        );
        const tgtField = tgtT.fields.find(
          (f) => f.id === (rel.targetFieldIds?.[0] ?? rel.targetFieldId)
        );
        if (!srcField || !tgtField) continue;
        const sourceCatalogTableId = srcT.catalogTableId;
        const targetCatalogTableId = tgtT.catalogTableId;
        const sourceFieldName = srcField.name;
        const targetFieldName = tgtField.name;
        const alreadyInCatalog = w.catalogRelationships.some(
          (r) =>
            r.sourceCatalogTableId === sourceCatalogTableId &&
            r.targetCatalogTableId === targetCatalogTableId &&
            r.sourceFieldName === sourceFieldName &&
            r.targetFieldName === targetFieldName
        );
        if (!alreadyInCatalog) {
          w.catalogRelationships.push({
            id: nextCatalogRelationshipId(),
            sourceCatalogTableId,
            targetCatalogTableId,
            sourceFieldName,
            targetFieldName,
          });
          catalogChanged = true;
        }
      }
      await saveTableCatalog(w.rootPath, w.catalogTables);
      if (catalogChanged)
        await saveCatalogRelationships(w.rootPath, w.catalogRelationships);
      showToast("Synced to catalog");
    };
    footerDiv.appendChild(syncBtn);
  }
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
    syncTableToCatalogAndDiagrams(tableId);
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

/** Edit a catalog table definition (name + fields). Does not add the table to any diagram. Saves to catalog and syncs to diagrams that already use this table. */
function showCatalogTableEditor(w: WorkspaceDoc, catalogId: string): void {
  const catalogEntry = w.catalogTables.find((c) => c.id === catalogId);
  if (!catalogEntry) return;
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
  nameLabel.htmlFor = "catalog-table-editor-name";
  headerDiv.appendChild(nameLabel);
  const nameInput = document.createElement("input");
  nameInput.id = "catalog-table-editor-name";
  nameInput.type = "text";
  nameInput.value = catalogEntry.name;
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

    rows.push({
      id: f.id,
      nameInput: nameIn,
      typeSelect: typeSel,
      nullableCb,
      pkCb,
      tr,
    });
    return nameIn;
  }

  catalogEntry.fields.forEach((f) =>
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

  function renderCatalogRelationships(): void {
    relContainer.innerHTML = "";
    const rels = w.catalogRelationships.filter(
      (r) =>
        r.sourceCatalogTableId === catalogId ||
        r.targetCatalogTableId === catalogId
    );
    rels.forEach((catRel) => {
      const weAreSource = catRel.sourceCatalogTableId === catalogId;
      const otherCatalogId = weAreSource
        ? catRel.targetCatalogTableId
        : catRel.sourceCatalogTableId;
      const otherEntry = w.catalogTables.find((c) => c.id === otherCatalogId);
      if (!otherEntry) return;
      const otherName = otherEntry.name;
      const card = document.createElement("div");
      card.className = "modal-relationship-card";
      const cardHeader = document.createElement("div");
      cardHeader.className = "modal-relationship-card-header";
      const targetLabel = document.createElement("div");
      targetLabel.className = "rel-target-name";
      targetLabel.textContent = weAreSource
        ? `Foreign: ${otherName}`
        : `Primary: ${otherName}`;
      cardHeader.appendChild(targetLabel);
      const deleteRelBtn = document.createElement("button");
      deleteRelBtn.type = "button";
      deleteRelBtn.className =
        "modal-field-delete-btn modal-relationship-delete";
      deleteRelBtn.title = "Delete relationship";
      deleteRelBtn.innerHTML = DELETE_ICON_SVG;
      deleteRelBtn.onclick = () => {
        const idx = w.catalogRelationships.findIndex((r) => r.id === catRel.id);
        if (idx >= 0) {
          w.catalogRelationships.splice(idx, 1);
          saveCatalogRelationships(w.rootPath, w.catalogRelationships).then(
            () => renderCatalogRelationships()
          );
        }
      };
      cardHeader.appendChild(deleteRelBtn);
      card.appendChild(cardHeader);
      const mapTable = document.createElement("table");
      mapTable.className = "modal-relationship-table";
      mapTable.innerHTML =
        "<thead><tr><th>Source Field</th><th>Target Field</th><th></th></tr></thead><tbody></tbody>";
      const mapTbody = mapTable.querySelector("tbody")!;
      const tr = document.createElement("tr");
      const srcTd = document.createElement("td");
      const srcSel = document.createElement("select");
      srcSel.className = "src-field";
      const ourFields = catalogEntry.fields;
      const theirFields = otherEntry.fields;
      const srcFields = weAreSource ? ourFields : theirFields;
      const tgtFields = weAreSource ? theirFields : ourFields;
      srcFields.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.name;
        opt.textContent = f.name;
        const currentSrcName = weAreSource
          ? catRel.sourceFieldName
          : catRel.targetFieldName;
        if (f.name === currentSrcName) opt.selected = true;
        srcSel.appendChild(opt);
      });
      srcSel.onchange = () => {
        const newSrcName = srcSel.value;
        const newTgtName = tgtSel.value;
        if (weAreSource) {
          catRel.sourceFieldName = newSrcName;
          catRel.targetFieldName = newTgtName;
        } else {
          catRel.sourceFieldName = newTgtName;
          catRel.targetFieldName = newSrcName;
        }
        saveCatalogRelationships(w.rootPath, w.catalogRelationships).then(
          () => {}
        );
      };
      srcTd.appendChild(srcSel);
      const tgtTd = document.createElement("td");
      const tgtSel = document.createElement("select");
      tgtSel.className = "tgt-field";
      tgtFields.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.name;
        opt.textContent = f.name;
        const currentTgtName = weAreSource
          ? catRel.targetFieldName
          : catRel.sourceFieldName;
        if (f.name === currentTgtName) opt.selected = true;
        tgtSel.appendChild(opt);
      });
      tgtSel.onchange = () => {
        const newSrcName = srcSel.value;
        const newTgtName = tgtSel.value;
        if (weAreSource) {
          catRel.sourceFieldName = newSrcName;
          catRel.targetFieldName = newTgtName;
        } else {
          catRel.sourceFieldName = newTgtName;
          catRel.targetFieldName = newSrcName;
        }
        saveCatalogRelationships(w.rootPath, w.catalogRelationships).then(
          () => {}
        );
      };
      tgtTd.appendChild(tgtSel);
      const delTd = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "modal-field-delete-btn";
      delBtn.innerHTML = DELETE_ICON_SVG;
      delBtn.title = "Remove relationship";
      delBtn.onclick = () => {
        const idx = w.catalogRelationships.findIndex((r) => r.id === catRel.id);
        if (idx >= 0) {
          w.catalogRelationships.splice(idx, 1);
          saveCatalogRelationships(w.rootPath, w.catalogRelationships).then(
            () => renderCatalogRelationships()
          );
        }
      };
      delTd.appendChild(delBtn);
      tr.appendChild(srcTd);
      tr.appendChild(tgtTd);
      tr.appendChild(delTd);
      mapTbody.appendChild(tr);
      card.appendChild(mapTable);
      relContainer.appendChild(card);
    });

    const addBlock = document.createElement("div");
    addBlock.className = "modal-add-relationship-block";
    const roleSelect = document.createElement("select");
    roleSelect.innerHTML =
      '<option value="source">This table is Primary</option><option value="target">This table is Foreign</option>';
    const tableSelect = document.createElement("select");
    w.catalogTables
      .filter((c) => c.id !== catalogId)
      .forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        tableSelect.appendChild(opt);
      });
    const srcFieldSelect = document.createElement("select");
    catalogEntry.fields.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.name;
      opt.textContent = f.name;
      srcFieldSelect.appendChild(opt);
    });
    const tgtFieldSelect = document.createElement("select");
    function updateTgtFieldOptions(): void {
      const otherId = tableSelect.value;
      const other = w.catalogTables.find((c) => c.id === otherId);
      tgtFieldSelect.innerHTML = "";
      if (other) {
        other.fields.forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f.name;
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
      const ourFieldName = srcFieldSelect.value;
      const theirFieldName = tgtFieldSelect.value;
      if (!otherId || !ourFieldName || !theirFieldName) return;
      const weAreSource = role === "source";
      const newRel: CatalogRelationship = {
        id: nextCatalogRelationshipId(),
        sourceCatalogTableId: weAreSource ? catalogId : otherId,
        targetCatalogTableId: weAreSource ? otherId : catalogId,
        sourceFieldName: weAreSource ? ourFieldName : theirFieldName,
        targetFieldName: weAreSource ? theirFieldName : ourFieldName,
      };
      w.catalogRelationships.push(newRel);
      saveCatalogRelationships(w.rootPath, w.catalogRelationships).then(() =>
        renderCatalogRelationships()
      );
    };
    addBlock.appendChild(createBtn);
    relContainer.appendChild(addBlock);
  }

  renderCatalogRelationships();
  relSection.appendChild(relContainer);
  contentDiv.appendChild(relSection);
  panel.appendChild(contentDiv);

  const footerDiv = document.createElement("div");
  footerDiv.className = "modal-table-editor-footer";
  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.textContent = "OK";
  okBtn.onclick = async () => {
    const name = nameInput.value.trim() || catalogEntry.name;
    const fields = rows.map((r) => ({
      id: r.id ?? nextFieldId(),
      name: r.nameInput.value.trim() || "field",
      type: r.typeSelect.value,
      nullable: r.nullableCb.checked,
      primaryKey: r.pkCb.checked,
    }));
    catalogEntry.name = name;
    catalogEntry.fields = fields;
    await saveTableCatalog(w.rootPath, w.catalogTables);
    const openPaths = new Set(w.innerDiagramTabs.map((t) => t.path));
    for (const tab of w.innerDiagramTabs) {
      const d = tab.store.getDiagram();
      const table = d.tables.find((t) => t.catalogTableId === catalogId);
      if (!table) continue;
      const fieldsForDiagram = fields.map((cf, i) => ({
        id: table.fields[i]?.id ?? nextFieldId(),
        name: cf.name,
        type: cf.type,
        nullable: cf.nullable,
        primaryKey: cf.primaryKey,
      }));
      tab.store.replaceTableContent(table.id, name, fieldsForDiagram);
      await syncDiagramRelationshipsToCatalog(w, tab.store.getDiagram());
      await bridge.saveFile(tab.path, JSON.stringify(tab.store.getDiagram()));
      tab.store.clearDirty();
    }
    if (bridge.isBackendAvailable()) {
      try {
        const files = await loadWorkspaceDiagramFiles(w);
        for (const filename of files) {
          const fullPath = pathJoin(w.rootPath, filename);
          if (openPaths.has(fullPath)) continue;
          try {
            const raw = await bridge.loadFile(fullPath);
            const d = JSON.parse(raw) as Diagram;
            const table = d.tables?.find((t) => t.catalogTableId === catalogId);
            if (!table) continue;
            table.name = name;
            const newFields = fields.map((cf, i) => ({
              id: table.fields[i]?.id ?? nextFieldId(),
              name: cf.name,
              type: cf.type.trim().toLowerCase() || "text",
              nullable: cf.nullable ?? false,
              primaryKey: cf.primaryKey ?? false,
            }));
            table.fields = newFields;
            const keptIds = new Set(newFields.map((f) => f.id));
            if (d.relationships) {
              d.relationships = d.relationships.filter(
                (r) =>
                  !(
                    r.sourceTableId === table.id &&
                    !keptIds.has(r.sourceFieldId)
                  ) &&
                  !(
                    r.targetTableId === table.id &&
                    !keptIds.has(r.targetFieldId)
                  )
              );
            }
            await bridge.saveFile(fullPath, JSON.stringify(d));
          } catch {
            // skip unreadable or unwritable file
          }
        }
      } catch {
        // fallback: open tabs already updated above
      }
    }
    overlay.remove();
    bindActiveTab();
    refreshTabStrip();
    updateEditorContentVisibility();
    renderWorkspaceView();
    const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
    if (inner) render();
    showToast("Table definition updated");
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
      const rel = store
        .getDiagram()
        .relationships.find((r) => r.id === relationshipId);
      store.deleteRelationship(relationshipId);
      if (rel) {
        const doc = getActiveDoc();
        if (doc?.type === "workspace")
          syncRelationshipRemovalFromCatalog(doc as WorkspaceDoc, rel).then(
            () => {}
          );
      }
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
      const doc = getActiveDoc();
      if (doc?.type === "workspace") {
        const w = doc as WorkspaceDoc;
        const d = store.getDiagram();
        const rel = d.relationships.find((r) => r.id === relationshipId);
        if (rel) syncRelationshipUpdateToCatalog(w, d, rel).then(() => {});
      }
    } else {
      const rel = store.addRelationshipWithMeta(
        sourceTableId,
        newSourceFieldIds,
        targetTableId,
        newTargetFieldIds,
        nameInput.value.trim() || undefined,
        noteInput.value.trim() || undefined,
        cardSelect.value || undefined
      );
      const doc = getActiveDoc();
      if (doc?.type === "workspace") {
        const w = doc as WorkspaceDoc;
        syncRelationshipToCatalog(w, store.getDiagram(), rel).then(() => {});
      }
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

function showDiagramListContextMenu(
  e: MouseEvent,
  w: WorkspaceDoc,
  filename: string
): void {
  showContextMenu(e.clientX, e.clientY, [
    { label: "Rename…", fn: () => renameWorkspaceDiagramFile(w, filename) },
  ]);
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

// --- Landing view ---
function showLanding(): void {
  viewMode = "landing";
  rootContainer.innerHTML = "";
  rootContainer.className = "app-root app-landing";

  const wrap = document.createElement("div");
  wrap.className = "landing-wrap";

  const iconEl = document.createElement("img");
  iconEl.className = "landing-app-icon";
  iconEl.src = "/appicon.svg";
  iconEl.alt = "";
  iconEl.setAttribute("aria-hidden", "true");
  wrap.appendChild(iconEl);

  const titleBlock = document.createElement("div");
  titleBlock.className = "landing-title-block";
  const title = document.createElement("h1");
  title.className = "landing-title";
  title.textContent = "Schema Studio";
  titleBlock.appendChild(title);
  const versionEl = document.createElement("div");
  versionEl.className = "landing-version";
  titleBlock.appendChild(versionEl);
  wrap.appendChild(titleBlock);
  bridge.getVersion().then((v) => {
    versionEl.textContent = v ? `v${v}` : "";
  });

  const startSection = document.createElement("div");
  startSection.className = "landing-section";
  const startLabel = document.createElement("h2");
  startLabel.className = "landing-section-title";
  startLabel.textContent = "Start";
  startSection.appendChild(startLabel);
  const startButtons = document.createElement("div");
  startButtons.className = "landing-buttons";
  const newWorkspaceBtn = document.createElement("button");
  newWorkspaceBtn.className = "landing-btn";
  newWorkspaceBtn.textContent = "New Workspace";
  newWorkspaceBtn.onclick = () => newWorkspaceTab();
  const openWorkspaceBtn = document.createElement("button");
  openWorkspaceBtn.className = "landing-btn";
  openWorkspaceBtn.textContent = "Open Workspace";
  openWorkspaceBtn.onclick = () => openWorkspaceTab();
  const newDiagramBtn = document.createElement("button");
  newDiagramBtn.className = "landing-btn";
  newDiagramBtn.textContent = "New Diagram";
  newDiagramBtn.onclick = () => newDiagramTab();
  const openDiagramBtn = document.createElement("button");
  openDiagramBtn.className = "landing-btn";
  openDiagramBtn.textContent = "Open Diagram";
  openDiagramBtn.onclick = () => openDiagramTab();
  startButtons.appendChild(newWorkspaceBtn);
  startButtons.appendChild(openWorkspaceBtn);
  startButtons.appendChild(newDiagramBtn);
  startButtons.appendChild(openDiagramBtn);
  startSection.appendChild(startButtons);
  wrap.appendChild(startSection);

  const recentSection = document.createElement("div");
  recentSection.className = "landing-section";
  const recentLabel = document.createElement("h2");
  recentLabel.className = "landing-section-title";
  recentLabel.textContent = "Recent";
  recentSection.appendChild(recentLabel);
  const recentList = document.createElement("div");
  recentList.className = "landing-recent-list";
  const recentEntries = getRecent();
  if (recentEntries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "landing-recent-empty";
    empty.textContent = "No recent items";
    recentList.appendChild(empty);
  } else {
    recentEntries.forEach((entry) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "landing-recent-item";
      row.textContent = entry.label || entry.path;
      row.title = entry.path;
      row.onclick = () => openRecentEntry(entry);
      recentList.appendChild(row);
    });
  }
  recentSection.appendChild(recentList);
  wrap.appendChild(recentSection);

  rootContainer.appendChild(wrap);
}

async function openRecentEntry(entry: RecentEntry): Promise<void> {
  if (entry.kind === "diagram") {
    await openDiagramTab(entry.path);
  } else if (entry.kind === "workspace") {
    await openWorkspaceTab(entry.path);
  }
}

function pathJoin(root: string, file: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  return root.endsWith(sep) ? root + file : root + sep + file;
}

async function loadWorkspaceConfig(rootPath: string): Promise<WorkspaceConfig> {
  const raw = await bridge.loadFile(pathJoin(rootPath, WORKSPACE_CONFIG_FILE));
  return JSON.parse(raw) as WorkspaceConfig;
}

async function loadTableCatalog(rootPath: string): Promise<CatalogTable[]> {
  try {
    const raw = await bridge.loadFile(pathJoin(rootPath, TABLE_CATALOG_FILE));
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as CatalogTable[]) : [];
  } catch {
    return [];
  }
}

async function saveWorkspaceConfig(
  rootPath: string,
  config: WorkspaceConfig
): Promise<void> {
  await bridge.saveFile(
    pathJoin(rootPath, WORKSPACE_CONFIG_FILE),
    JSON.stringify(config, null, 2)
  );
}

async function saveTableCatalog(
  rootPath: string,
  tables: CatalogTable[]
): Promise<void> {
  await bridge.saveFile(
    pathJoin(rootPath, TABLE_CATALOG_FILE),
    JSON.stringify(tables, null, 2)
  );
}

async function loadCatalogRelationships(
  rootPath: string
): Promise<CatalogRelationship[]> {
  if (!bridge.isBackendAvailable()) return [];
  try {
    const raw = await bridge.loadFile(
      pathJoin(rootPath, CATALOG_RELATIONSHIPS_FILE)
    );
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as CatalogRelationship[]) : [];
  } catch {
    return [];
  }
}

async function saveCatalogRelationships(
  rootPath: string,
  relationships: CatalogRelationship[]
): Promise<void> {
  if (!bridge.isBackendAvailable()) return;
  await bridge.saveFile(
    pathJoin(rootPath, CATALOG_RELATIONSHIPS_FILE),
    JSON.stringify(relationships, null, 2)
  );
}

async function loadWorkspaceUIState(
  rootPath: string
): Promise<WorkspaceUIState> {
  if (!bridge.isBackendAvailable()) return {};
  try {
    const raw = await bridge.loadFile(pathJoin(rootPath, WORKSPACE_STATE_FILE));
    return JSON.parse(raw) as WorkspaceUIState;
  } catch {
    return {};
  }
}

async function saveWorkspaceUIState(
  rootPath: string,
  state: WorkspaceUIState
): Promise<void> {
  if (!bridge.isBackendAvailable()) return;
  try {
    await bridge.saveFile(
      pathJoin(rootPath, WORKSPACE_STATE_FILE),
      JSON.stringify(state, null, 2)
    );
  } catch {
    // ignore
  }
}

async function newWorkspaceTab(): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available (run in Wails)");
    return;
  }
  try {
    const rootPath = await bridge.openDirectoryDialog(
      "Choose workspace folder"
    );
    if (!rootPath) return;
    const config: WorkspaceConfig = {
      name: "New Workspace",
      description: "",
      autoSaveDiagrams: false,
    };
    await saveWorkspaceConfig(rootPath, config);
    await saveTableCatalog(rootPath, []);
    const label = rootPath.split(/[/\\]/).filter(Boolean).pop() ?? "Workspace";
    await saveCatalogRelationships(rootPath, []);
    const doc: WorkspaceDoc = {
      type: "workspace",
      id: nextDocId(),
      label,
      rootPath,
      name: config.name,
      description: config.description,
      catalogTables: [],
      catalogRelationships: [],
      innerDiagramTabs: [],
      activeInnerDiagramIndex: -1,
      autoSaveDiagrams: config.autoSaveDiagrams ?? false,
      workspaceUIState: {
        catalogOpen: true,
        diagramsOpen: true,
        settingsOpen: false,
      },
    };
    currentWorkspace = doc;
    addRecent({
      path: rootPath,
      kind: "workspace",
      label,
      lastOpened: Date.now(),
    });
    showWorkspaceView();
    appendStatus(`Created workspace ${rootPath}`);
    showToast("Workspace created");
  } catch (e) {
    showToast("Failed: " + (e as Error).message);
  }
}

async function openWorkspaceTab(path?: string): Promise<void> {
  let rootPath = path;
  if (rootPath === undefined) {
    if (!bridge.isBackendAvailable()) {
      showToast("Backend not available (run in Wails)");
      return;
    }
    try {
      rootPath = await bridge.openDirectoryDialog("Open workspace folder");
    } catch (e) {
      showToast("Open failed: " + (e as Error).message);
      return;
    }
    if (!rootPath) return;
  }
  try {
    const config = await loadWorkspaceConfig(rootPath);
    const catalogTables = await loadTableCatalog(rootPath);
    const catalogRelationships = await loadCatalogRelationships(rootPath);
    const workspaceUIState = await loadWorkspaceUIState(rootPath);
    const label =
      config.name ||
      (rootPath.split(/[/\\]/).filter(Boolean).pop() ?? "Workspace");
    const doc: WorkspaceDoc = {
      type: "workspace",
      id: nextDocId(),
      label,
      rootPath,
      name: config.name,
      description: config.description,
      catalogTables,
      catalogRelationships,
      innerDiagramTabs: [],
      activeInnerDiagramIndex: -1,
      autoSaveDiagrams: config.autoSaveDiagrams ?? false,
      workspaceUIState,
    };
    currentWorkspace = doc;
    addRecent({
      path: rootPath,
      kind: "workspace",
      label,
      lastOpened: Date.now(),
    });
    showWorkspaceView();
    appendStatus(`Opened workspace ${rootPath}`);
    showToast("Opened workspace");
  } catch (e) {
    showToast("Open failed: " + (e as Error).message);
  }
}

function showWorkspaceView(): void {
  viewMode = "editor";
  rootContainer.innerHTML = "";
  rootContainer.className = "app-root app-editor app-workspace";

  menuBarEl = document.createElement("div");
  menuBarEl.className = "menu-bar";
  setupMenuBar(menuBarEl);
  rootContainer.appendChild(menuBarEl);

  const workspaceBody = document.createElement("div");
  workspaceBody.className = "workspace-body";
  workspacePanelEl = workspaceBody;
  rootContainer.appendChild(workspaceBody);

  if (!diagramPanelEl) {
    diagramPanelEl = document.createElement("div");
    diagramPanelEl.className = "diagram-panel";
    container = diagramPanelEl;
    setupToolbar();
    setupCanvas();
    editorInitialized = true;
  }

  renderWorkspaceView();
  const w = currentWorkspace;
  const diagramContainer = workspacePanelEl.querySelector(
    ".workspace-diagram-container"
  );
  if (
    diagramContainer &&
    diagramPanelEl &&
    w &&
    w.innerDiagramTabs.length > 0 &&
    w.activeInnerDiagramIndex >= 0
  ) {
    if (diagramPanelEl.parentNode !== diagramContainer) {
      diagramContainer.appendChild(diagramPanelEl);
    }
    diagramPanelEl.style.display = "";
  }

  bindActiveTab();
  updateStatusContext();
  updateMenuState();
  appendStatus("Ready. Use Import/Export from the toolbar.");
}

function bindActiveTab(): void {
  if (autoSaveTimeoutId) {
    clearTimeout(autoSaveTimeoutId);
    autoSaveTimeoutId = null;
  }
  const doc = getActiveDoc();
  if (doc && doc.type === "diagram") {
    store = doc.store;
    currentFilePath = doc.path;
    const d = store.getDiagram();
    if (d.viewport) {
      pan.x = d.viewport.panX ?? 0;
      pan.y = d.viewport.panY ?? 0;
      zoom = d.viewport.zoom ?? 1;
    } else {
      pan.x = 0;
      pan.y = 0;
      zoom = 1;
    }
    updateTransform();
    selection = null;
    render();
  } else if (doc && doc.type === "workspace") {
    const w = doc as WorkspaceDoc;
    if (
      w.innerDiagramTabs.length > 0 &&
      w.activeInnerDiagramIndex >= 0 &&
      w.activeInnerDiagramIndex < w.innerDiagramTabs.length
    ) {
      const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
      store = inner.store;
      currentFilePath = inner.path;
      const d = store.getDiagram();
      if (d.viewport) {
        pan.x = d.viewport.panX ?? 0;
        pan.y = d.viewport.panY ?? 0;
        zoom = d.viewport.zoom ?? 1;
      } else {
        pan.x = 0;
        pan.y = 0;
        zoom = 1;
      }
      updateTransform();
      selection = null;
      render();
    } else {
      store = new Store(); // dummy when no inner diagram
      currentFilePath = null;
    }
  }
  if (bindStoreSubscription) bindStoreSubscription();
  updateEditorContentVisibility();
  updateStatusContext();
  updateMenuState();
}

function persistViewportToStore(): void {
  const doc = getActiveDoc();
  if (doc && doc.type === "diagram") {
    doc.store.setViewport({ panX: pan.x, panY: pan.y, zoom });
  } else if (doc && doc.type === "workspace") {
    const w = doc as WorkspaceDoc;
    const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
    if (inner) inner.store.setViewport({ panX: pan.x, panY: pan.y, zoom });
  }
}

function refreshTabStrip(): void {
  if (currentWorkspace || !tabStripEl) return;
  tabStripEl.innerHTML = "";
  documents.forEach((doc, i) => {
    const tab = document.createElement("div");
    tab.className =
      "tab-strip-tab" + (i === activeDocIndex ? " tab-strip-tab-active" : "");
    const label = document.createElement("span");
    label.className = "tab-strip-tab-label";
    label.textContent = doc.type === "diagram" ? doc.label : doc.label;
    const unsaved = doc.type === "diagram" && doc.store.isDirty();
    if (unsaved) {
      label.textContent += " •";
      tab.title = "Unsaved changes";
    }
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tab-strip-tab-close";
    closeBtn.innerHTML = "×";
    closeBtn.title = "Close";
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeTab(i);
    };
    tab.appendChild(label);
    tab.appendChild(closeBtn);
    tab.onclick = () => switchToTab(i);
    tabStripEl!.appendChild(tab);
  });
}

function switchToTab(i: number): void {
  if (i === activeDocIndex || i < 0 || i >= documents.length) return;
  persistViewportToStore();
  activeDocIndex = i;
  bindActiveTab();
  refreshTabStrip();
  appendStatus(
    getActiveDoc()?.type === "diagram"
      ? `Switched to ${(getActiveDoc() as DiagramDoc).label}`
      : "Switched tab"
  );
}

async function closeTab(i: number): Promise<void> {
  const doc = documents[i];
  if (!doc) return;
  if (doc.type === "diagram" && doc.store.isDirty()) {
    store = doc.store;
    currentFilePath = doc.path;
    const choice = await confirmUnsavedChanges();
    if (choice === "cancel") return;
    if (choice === "save") {
      const saved = await saveDiagram();
      if (!saved) return;
      /* saveDiagram() already updates doc path and addRecent */
    }
  }
  documents.splice(i, 1);
  if (documents.length === 0) {
    activeDocIndex = -1;
    store = new Store(); // dummy so no null refs
    currentFilePath = null;
    showLanding();
    return;
  }
  if (activeDocIndex >= documents.length) activeDocIndex = documents.length - 1;
  if (activeDocIndex === i && i > 0) activeDocIndex = i - 1;
  else if (activeDocIndex >= i && activeDocIndex > 0) activeDocIndex--;
  bindActiveTab();
  refreshTabStrip();
}

function newDiagramTab(): void {
  const newStore = new Store();
  const doc: DiagramDoc = {
    type: "diagram",
    id: nextDocId(),
    label: "Untitled",
    store: newStore,
    path: null,
  };
  documents.push(doc);
  activeDocIndex = documents.length - 1;
  showEditor();
}

async function openDiagramTab(path?: string): Promise<void> {
  let targetPath = path;
  if (targetPath === undefined) {
    if (!bridge.isBackendAvailable()) {
      showToast("Backend not available (run in Wails)");
      return;
    }
    try {
      targetPath = await bridge.openFileDialog(
        "Open diagram",
        "Diagram",
        "*.diagram"
      );
    } catch (e) {
      showToast("Open failed: " + (e as Error).message);
      return;
    }
    if (!targetPath) return;
  }
  try {
    const raw = await bridge.loadFile(targetPath);
    const d = JSON.parse(raw) as Diagram;
    const newStore = new Store(d);
    const label = targetPath.split(/[/\\]/).pop() ?? "Untitled";
    const doc: DiagramDoc = {
      type: "diagram",
      id: nextDocId(),
      label,
      store: newStore,
      path: targetPath,
    };
    documents.push(doc);
    activeDocIndex = documents.length - 1;
    showEditor();
    addRecent({
      path: targetPath,
      kind: "diagram",
      label,
      lastOpened: Date.now(),
    });
    appendStatus(`Opened ${targetPath}`);
    showToast("Opened");
  } catch (e) {
    showToast("Open failed: " + (e as Error).message);
  }
}

let diagramPanelEl: HTMLElement | null = null;
let workspacePanelEl: HTMLElement | null = null;

function updateEditorContentVisibility(): void {
  const doc = getActiveDoc();
  if (!diagramPanelEl) return;
  if (doc?.type === "diagram") {
    if (editorContentEl && diagramPanelEl.parentNode !== editorContentEl) {
      editorContentEl.appendChild(diagramPanelEl);
    }
    diagramPanelEl.style.display = "";
    if (workspacePanelEl) workspacePanelEl.style.display = "none";
  } else if (doc?.type === "workspace" && workspacePanelEl) {
    workspacePanelEl.style.display = "";
    renderWorkspaceView();
    const w = doc as WorkspaceDoc;
    const diagramContainer = workspacePanelEl.querySelector(
      ".workspace-diagram-container"
    );
    if (
      diagramContainer &&
      w.innerDiagramTabs.length > 0 &&
      w.activeInnerDiagramIndex >= 0
    ) {
      if (diagramPanelEl.parentNode !== diagramContainer) {
        diagramContainer.appendChild(diagramPanelEl);
      }
      diagramPanelEl.style.display = "";
    } else {
      diagramPanelEl.style.display = "none";
      if (
        diagramPanelEl.parentNode &&
        editorContentEl &&
        diagramPanelEl.parentNode !== editorContentEl
      ) {
        editorContentEl.appendChild(diagramPanelEl);
      }
    }
  }
}

function renderWorkspaceView(): void {
  const doc = getActiveDoc();
  if (!workspacePanelEl || doc?.type !== "workspace") return;
  const w = doc as WorkspaceDoc;

  const existingSidebar = workspacePanelEl.querySelector(".workspace-sidebar");
  if (existingSidebar) {
    const catalogAcc = workspacePanelEl.querySelector(
      ".workspace-accordion-catalog"
    );
    const diagramsAcc = workspacePanelEl.querySelector(
      ".workspace-accordion-diagrams"
    );
    const settingsAcc = workspacePanelEl.querySelector(
      ".workspace-accordion-settings"
    );
    const catalogContentEl = catalogAcc?.querySelector(
      ".workspace-accordion-content"
    );
    const diagramsContentEl = diagramsAcc?.querySelector(
      ".workspace-accordion-content"
    );
    const prev = w.workspaceUIState ?? {};
    w.workspaceUIState = {
      catalogOpen:
        catalogAcc?.classList.contains("open") ?? prev.catalogOpen ?? true,
      diagramsOpen:
        diagramsAcc?.classList.contains("open") ?? prev.diagramsOpen ?? true,
      settingsOpen:
        settingsAcc?.classList.contains("open") ?? prev.settingsOpen ?? false,
      sidebarScrollTop:
        (existingSidebar as HTMLElement).scrollTop ?? prev.sidebarScrollTop,
      catalogContentScrollTop:
        (catalogContentEl as HTMLElement)?.scrollTop ??
        prev.catalogContentScrollTop,
      diagramsContentScrollTop:
        (diagramsContentEl as HTMLElement)?.scrollTop ??
        prev.diagramsContentScrollTop,
    };
    saveWorkspaceUIState(w.rootPath, w.workspaceUIState).catch(() => {});
  }

  if (diagramPanelEl && workspacePanelEl.contains(diagramPanelEl)) {
    (editorContentEl ?? rootContainer).appendChild(diagramPanelEl);
  }
  workspacePanelEl.innerHTML = "";
  workspacePanelEl.className = "workspace-panel workspace-view";

  const layout = document.createElement("div");
  layout.className = "workspace-layout";

  const sidebar = document.createElement("div");
  sidebar.className = "workspace-sidebar";

  const catalogAccordion = document.createElement("div");
  catalogAccordion.className =
    "workspace-accordion workspace-accordion-catalog";
  const catalogHeader = document.createElement("button");
  catalogHeader.type = "button";
  catalogHeader.className = "workspace-accordion-header";
  catalogHeader.textContent = "Table Catalog";
  catalogAccordion.appendChild(catalogHeader);
  const catalogContent = document.createElement("div");
  catalogContent.className = "workspace-accordion-content";
  const catalogList = document.createElement("div");
  catalogList.className = "workspace-catalog-list";
  w.catalogTables.forEach((t) => {
    const row = document.createElement("div");
    row.className = "workspace-catalog-item";
    const label = document.createElement("span");
    label.textContent = t.name;
    label.className = "workspace-catalog-item-label";
    row.appendChild(label);
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "workspace-catalog-item-delete";
    deleteBtn.title = "Remove from catalog";
    deleteBtn.innerHTML = TRASH_ICON_SVG;
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      confirmRemoveCatalogTable(w, t.id, t.name).catch(() => {});
    };
    row.appendChild(deleteBtn);
    row.draggable = true;
    row.dataset.catalogId = t.id;
    row.ondragstart = (e) => {
      e.dataTransfer?.setData("catalogTableId", t.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    };
    row.ondblclick = () => openCatalogTableEditor(w, t.id);
    catalogList.appendChild(row);
  });
  if (w.catalogTables.length === 0) {
    const empty = document.createElement("div");
    empty.className = "workspace-empty-msg";
    empty.textContent = "No tables yet";
    catalogList.appendChild(empty);
  }
  catalogContent.appendChild(catalogList);
  catalogAccordion.appendChild(catalogContent);
  sidebar.appendChild(catalogAccordion);

  const diagramsAccordion = document.createElement("div");
  diagramsAccordion.className =
    "workspace-accordion workspace-accordion-diagrams";
  const diagramsHeader = document.createElement("button");
  diagramsHeader.type = "button";
  diagramsHeader.className = "workspace-accordion-header";
  diagramsHeader.textContent = "Diagrams";
  diagramsAccordion.appendChild(diagramsHeader);
  const diagramsContent = document.createElement("div");
  diagramsContent.className = "workspace-accordion-content";
  const diagramsList = document.createElement("div");
  diagramsList.className = "workspace-diagrams-list";
  loadWorkspaceDiagramFiles(w).then((files) => {
    files.forEach((filename) => {
      const row = document.createElement("div");
      row.className = "workspace-diagram-item";
      const label = document.createElement("span");
      label.className = "workspace-diagram-item-label";
      label.textContent = filename;
      row.appendChild(label);
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "workspace-diagram-item-delete";
      deleteBtn.title = "Delete diagram";
      deleteBtn.innerHTML = TRASH_ICON_SVG;
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        confirmDeleteDiagram(w, filename);
      };
      row.appendChild(deleteBtn);
      row.onclick = (e) => {
        if (!(e.target as Element).closest(".workspace-diagram-item-delete")) {
          openWorkspaceDiagramFile(w, filename);
        }
      };
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showDiagramListContextMenu(e, w, filename);
      });
      diagramsList.appendChild(row);
    });
    if (files.length === 0) {
      const empty = document.createElement("div");
      empty.className = "workspace-empty-msg";
      empty.textContent = "No diagram files";
      diagramsList.appendChild(empty);
    }
  });
  diagramsContent.appendChild(diagramsList);
  const newDiagramBtn = document.createElement("button");
  newDiagramBtn.type = "button";
  newDiagramBtn.className = "workspace-new-diagram-btn";
  newDiagramBtn.textContent = "New Diagram";
  newDiagramBtn.onclick = () => {
    const doc = getActiveDoc();
    if (doc?.type !== "workspace") return;
    newWorkspaceDiagram(doc as WorkspaceDoc);
  };
  diagramsContent.appendChild(newDiagramBtn);
  diagramsAccordion.appendChild(diagramsContent);
  sidebar.appendChild(diagramsAccordion);

  const settingsAccordion = document.createElement("div");
  settingsAccordion.className =
    "workspace-accordion workspace-accordion-settings";
  const settingsHeader = document.createElement("button");
  settingsHeader.type = "button";
  settingsHeader.className = "workspace-accordion-header";
  settingsHeader.textContent = "Workspace Settings";
  settingsAccordion.appendChild(settingsHeader);
  const settingsContent = document.createElement("div");
  settingsContent.className = "workspace-accordion-content";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "workspace-settings-input";
  nameInput.value = w.name;
  const descLabel = document.createElement("label");
  descLabel.textContent = "Description";
  const descInput = document.createElement("textarea");
  descInput.className = "workspace-settings-input";
  descInput.rows = 2;
  descInput.value = w.description ?? "";
  const autoSaveLabel = document.createElement("label");
  autoSaveLabel.style.display = "flex";
  autoSaveLabel.style.alignItems = "center";
  autoSaveLabel.style.gap = "0.5rem";
  autoSaveLabel.style.marginBottom = "0.5rem";
  autoSaveLabel.style.cursor = "pointer";
  const autoSaveCheckbox = document.createElement("input");
  autoSaveCheckbox.type = "checkbox";
  autoSaveCheckbox.checked = w.autoSaveDiagrams ?? false;
  autoSaveLabel.appendChild(autoSaveCheckbox);
  const autoSaveText = document.createElement("span");
  autoSaveText.textContent = "Auto-save diagrams";
  autoSaveLabel.appendChild(autoSaveText);
  const saveSettingsBtn = document.createElement("button");
  saveSettingsBtn.type = "button";
  saveSettingsBtn.textContent = "Save";
  saveSettingsBtn.onclick = () =>
    saveWorkspaceSettings(
      w,
      nameInput.value,
      descInput.value,
      autoSaveCheckbox.checked
    );
  settingsContent.appendChild(nameLabel);
  settingsContent.appendChild(nameInput);
  settingsContent.appendChild(descLabel);
  settingsContent.appendChild(descInput);
  settingsContent.appendChild(autoSaveLabel);
  settingsContent.appendChild(saveSettingsBtn);
  settingsAccordion.appendChild(settingsContent);
  sidebar.appendChild(settingsAccordion);

  layout.appendChild(sidebar);

  const main = document.createElement("div");
  main.className = "workspace-main";

  const innerTabStrip = document.createElement("div");
  innerTabStrip.className = "workspace-inner-tabs";
  w.innerDiagramTabs.forEach((inner, i) => {
    const tab = document.createElement("div");
    const dirty = inner.store.isDirty();
    tab.className =
      "workspace-inner-tab" +
      (i === w.activeInnerDiagramIndex ? " workspace-inner-tab-active" : "") +
      (dirty ? " workspace-inner-tab-dirty" : "");
    tab.textContent = inner.label + (dirty ? " •" : "");
    tab.title = dirty ? "Unsaved changes" : "";
    tab.onclick = () => switchWorkspaceInnerTab(w, i);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "workspace-inner-tab-close";
    closeBtn.innerHTML = "×";
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeWorkspaceInnerTab(w, i);
    };
    tab.appendChild(closeBtn);
    innerTabStrip.appendChild(tab);
  });
  main.appendChild(innerTabStrip);

  const diagramContainer = document.createElement("div");
  diagramContainer.className = "workspace-diagram-container";
  if (w.innerDiagramTabs.length === 0 || w.activeInnerDiagramIndex < 0) {
    const noDiagram = document.createElement("div");
    noDiagram.className = "workspace-no-diagram";
    noDiagram.textContent = "Open a diagram from the list or create a new one.";
    diagramContainer.appendChild(noDiagram);
  }
  main.appendChild(diagramContainer);
  layout.appendChild(main);
  workspacePanelEl.appendChild(layout);

  const ui = w.workspaceUIState ?? {};
  if (ui.catalogOpen !== false) catalogAccordion.classList.add("open");
  if (ui.diagramsOpen !== false) diagramsAccordion.classList.add("open");
  if (ui.settingsOpen === true) settingsAccordion.classList.add("open");
  reattachWorkspaceDiagramPanel();
  const applyScroll = (): void => {
    if (typeof ui.sidebarScrollTop === "number" && ui.sidebarScrollTop >= 0) {
      sidebar.scrollTop = ui.sidebarScrollTop;
    }
    if (
      typeof ui.catalogContentScrollTop === "number" &&
      ui.catalogContentScrollTop >= 0
    ) {
      catalogContent.scrollTop = ui.catalogContentScrollTop;
    }
    if (
      typeof ui.diagramsContentScrollTop === "number" &&
      ui.diagramsContentScrollTop >= 0
    ) {
      diagramsContent.scrollTop = ui.diagramsContentScrollTop;
    }
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(applyScroll);
  });
  setTimeout(applyScroll, 120);

  const persistSidebarState = (): void => {
    w.workspaceUIState = {
      catalogOpen: catalogAccordion.classList.contains("open"),
      diagramsOpen: diagramsAccordion.classList.contains("open"),
      settingsOpen: settingsAccordion.classList.contains("open"),
      sidebarScrollTop: sidebar.scrollTop,
      catalogContentScrollTop: catalogContent.scrollTop,
      diagramsContentScrollTop: diagramsContent.scrollTop,
    };
    saveWorkspaceUIState(w.rootPath, w.workspaceUIState).catch(() => {});
  };

  let sidebarScrollTimeout: ReturnType<typeof setTimeout> | null = null;
  const debouncedPersist = (): void => {
    if (sidebarScrollTimeout) clearTimeout(sidebarScrollTimeout);
    sidebarScrollTimeout = setTimeout(() => {
      sidebarScrollTimeout = null;
      persistSidebarState();
    }, 150);
  };
  sidebar.addEventListener("scroll", debouncedPersist);
  catalogContent.addEventListener("scroll", debouncedPersist);
  diagramsContent.addEventListener("scroll", debouncedPersist);

  catalogHeader.onclick = () => {
    catalogAccordion.classList.toggle("open");
    persistSidebarState();
  };
  diagramsHeader.onclick = () => {
    diagramsAccordion.classList.toggle("open");
    persistSidebarState();
  };
  settingsHeader.onclick = () => {
    settingsAccordion.classList.toggle("open");
    persistSidebarState();
  };
}

/** Update inner diagram tab labels (dirty • and class) without rebuilding the whole workspace view. */
function updateWorkspaceInnerTabLabels(): void {
  const doc = getActiveDoc();
  if (doc?.type !== "workspace" || !workspacePanelEl) return;
  const w = doc as WorkspaceDoc;
  const strip = workspacePanelEl.querySelector(".workspace-inner-tabs");
  if (!strip || w.innerDiagramTabs.length !== strip.children.length) return;
  w.innerDiagramTabs.forEach((inner, i) => {
    const tab = strip.children[i] as HTMLElement;
    if (!tab) return;
    const dirty = inner.store.isDirty();
    const closeBtn = tab.querySelector(".workspace-inner-tab-close");
    tab.className =
      "workspace-inner-tab" +
      (i === w.activeInnerDiagramIndex ? " workspace-inner-tab-active" : "") +
      (dirty ? " workspace-inner-tab-dirty" : "");
    tab.textContent = inner.label + (dirty ? " •" : "");
    tab.title = dirty ? "Unsaved changes" : "";
    if (closeBtn) tab.appendChild(closeBtn);
  });
}

function reattachWorkspaceDiagramPanel(): void {
  const doc = getActiveDoc();
  if (doc?.type !== "workspace" || !workspacePanelEl || !diagramPanelEl) return;
  const w = doc as WorkspaceDoc;
  if (w.innerDiagramTabs.length === 0 || w.activeInnerDiagramIndex < 0) return;
  const diagramContainer = workspacePanelEl.querySelector(
    ".workspace-diagram-container"
  );
  if (diagramContainer && diagramPanelEl.parentNode !== diagramContainer) {
    diagramContainer.appendChild(diagramPanelEl);
    diagramPanelEl.style.display = "";
  }
}

function sanitizeDiagramFilename(name: string): string {
  const s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "diagram";
  return s.endsWith(".diagram") ? s : s + ".diagram";
}

async function renameWorkspaceDiagramFile(
  w: WorkspaceDoc,
  oldFilename: string
): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available");
    return;
  }
  const oldFullPath = pathJoin(w.rootPath, oldFilename);
  const currentLabel = oldFilename.replace(/\.diagram$/i, "") || "Diagram";
  const raw = window.prompt("Rename diagram", currentLabel);
  if (raw == null || raw.trim() === "") return;
  const newFilename = sanitizeDiagramFilename(raw.trim());
  if (newFilename === oldFilename) return;
  const newFullPath = pathJoin(w.rootPath, newFilename);
  try {
    const existing = await loadWorkspaceDiagramFiles(w);
    if (existing.some((f) => f.toLowerCase() === newFilename.toLowerCase())) {
      showToast("A diagram with that name already exists");
      return;
    }
    const tab = w.innerDiagramTabs.find((t) => t.path === oldFullPath);
    const content = tab
      ? JSON.stringify(tab.store.getDiagram())
      : await bridge.loadFile(oldFullPath);
    await bridge.saveFile(newFullPath, content);
    await bridge.removeFile(oldFullPath);
    if (tab) {
      tab.path = newFullPath;
      tab.label = newFilename.replace(/\.diagram$/i, "") || "Diagram";
    }
    renderWorkspaceView();
    refreshTabStrip();
    appendStatus(`Renamed to ${newFilename}`);
    showToast("Renamed");
  } catch (e) {
    showToast("Rename failed: " + (e as Error).message);
  }
}

async function loadWorkspaceDiagramFiles(w: WorkspaceDoc): Promise<string[]> {
  if (!bridge.isBackendAvailable()) return [];
  try {
    return await bridge.listFiles(w.rootPath, "*.diagram");
  } catch {
    return [];
  }
}

async function openWorkspaceDiagramFile(
  w: WorkspaceDoc,
  filename: string
): Promise<void> {
  const fullPath = pathJoin(w.rootPath, filename);
  try {
    const raw = await bridge.loadFile(fullPath);
    const d = JSON.parse(raw) as Diagram;
    const newStore = new Store(d);
    const existing = w.innerDiagramTabs.find((t) => t.path === fullPath);
    if (existing) {
      const idx = w.innerDiagramTabs.indexOf(existing);
      w.activeInnerDiagramIndex = idx;
      bindActiveTab();
      refreshTabStrip();
      updateEditorContentVisibility();
      renderWorkspaceView();
      return;
    }
    const label = filename.replace(/\.diagram$/i, "") || "Diagram";
    w.innerDiagramTabs.push({
      id: nextDocId(),
      label,
      store: newStore,
      path: fullPath,
    });
    w.activeInnerDiagramIndex = w.innerDiagramTabs.length - 1;
    bindActiveTab();
    refreshTabStrip();
    updateEditorContentVisibility();
    renderWorkspaceView();
    appendStatus(`Opened ${filename}`);
  } catch (e) {
    showToast("Open failed: " + (e as Error).message);
  }
}

function showNewDiagramModal(w: WorkspaceDoc): void {
  const suggested =
    "diagram" +
    (w.innerDiagramTabs.length > 0
      ? String(w.innerDiagramTabs.length + 1)
      : "");

  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const panel = document.createElement("div");
  panel.className =
    "modal-panel modal-panel-workspace-settings modal-panel-new-diagram";

  const headerDiv = document.createElement("div");
  headerDiv.className = "modal-workspace-settings-header";
  const title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = "New Diagram";
  headerDiv.appendChild(title);
  panel.appendChild(headerDiv);

  const contentDiv = document.createElement("div");
  contentDiv.className = "modal-workspace-settings-content";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Diagram name";
  nameLabel.htmlFor = "new-diagram-name";
  contentDiv.appendChild(nameLabel);
  const nameInput = document.createElement("input");
  nameInput.id = "new-diagram-name";
  nameInput.type = "text";
  nameInput.value = suggested;
  nameInput.className = "modal-input";
  nameInput.placeholder = "e.g. diagram, my-schema";
  contentDiv.appendChild(nameInput);
  panel.appendChild(contentDiv);

  const footerDiv = document.createElement("div");
  footerDiv.className = "modal-workspace-settings-footer";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => overlay.remove();
  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.textContent = "Create";
  createBtn.onclick = () => {
    const baseName = nameInput.value.trim() || "diagram";
    overlay.remove();
    createWorkspaceDiagramWithName(w, baseName).catch((e) =>
      showToast("Failed: " + (e as Error).message)
    );
  };
  footerDiv.appendChild(cancelBtn);
  footerDiv.appendChild(createBtn);
  panel.appendChild(footerDiv);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  nameInput.focus();
  nameInput.select();
}

async function createWorkspaceDiagramWithName(
  w: WorkspaceDoc,
  baseName: string
): Promise<void> {
  let filename = sanitizeDiagramFilename(baseName);
  try {
    const existing = await loadWorkspaceDiagramFiles(w);
    const existingSet = new Set(existing.map((f) => f.toLowerCase()));
    if (existingSet.has(filename.toLowerCase())) {
      let n = 1;
      const stem = filename.replace(/\.diagram$/i, "");
      while (existingSet.has(filename.toLowerCase())) {
        filename = stem + n + ".diagram";
        n++;
      }
    }
  } catch (_) {
    // use chosen filename if list fails
  }
  const fullPath = pathJoin(w.rootPath, filename);
  const label = filename.replace(/\.diagram$/i, "") || "Diagram";
  const newStore = new Store();
  w.innerDiagramTabs.push({
    id: nextDocId(),
    label,
    store: newStore,
    path: fullPath,
  });
  w.activeInnerDiagramIndex = w.innerDiagramTabs.length - 1;
  bindActiveTab();
  refreshTabStrip();
  updateEditorContentVisibility();
  try {
    await bridge.saveFile(fullPath, JSON.stringify(newStore.getDiagram()));
    appendStatus(`Created ${filename}`);
    showToast("New diagram");
  } catch (e) {
    appendStatus(
      `Saved diagram to catalog; file write failed: ${(e as Error).message}`,
      "error"
    );
    showToast("New diagram (save to disk failed)");
  }
  renderWorkspaceView();
}

function newWorkspaceDiagram(w: WorkspaceDoc): void {
  showNewDiagramModal(w);
}

function switchWorkspaceInnerTab(w: WorkspaceDoc, index: number): void {
  if (index === w.activeInnerDiagramIndex) return;
  persistViewportToStore();
  const leavingInner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
  if (leavingInner && w.autoSaveDiagrams && leavingInner.store.isDirty()) {
    const path = leavingInner.path;
    const diagram = leavingInner.store.getDiagram();
    syncDiagramRelationshipsToCatalog(w, diagram)
      .then(() => bridge.saveFile(path, JSON.stringify(diagram)))
      .then(() => {
        leavingInner.store.clearDirty();
        refreshTabStrip();
        if (workspacePanelEl) renderWorkspaceView();
        appendStatus("Auto-saved");
      })
      .catch(() => showToast("Auto-save failed"));
  }
  w.activeInnerDiagramIndex = index;
  bindActiveTab();
  refreshTabStrip();
  updateWorkspaceInnerTabLabels();
  reattachWorkspaceDiagramPanel();
}

async function closeWorkspaceInnerTab(
  w: WorkspaceDoc,
  index: number
): Promise<void> {
  const inner = w.innerDiagramTabs[index];
  if (!inner) return;
  if (inner.store.isDirty()) {
    store = inner.store;
    currentFilePath = inner.path;
    const choice = await confirmUnsavedChanges();
    if (choice === "cancel") return;
    if (choice === "save") {
      await syncDiagramRelationshipsToCatalog(w, inner.store.getDiagram());
      await bridge.saveFile(
        inner.path,
        JSON.stringify(inner.store.getDiagram())
      );
      inner.store.clearDirty();
    }
  }
  w.innerDiagramTabs.splice(index, 1);
  if (w.activeInnerDiagramIndex >= w.innerDiagramTabs.length) {
    w.activeInnerDiagramIndex = Math.max(0, w.innerDiagramTabs.length - 1);
  } else if (index < w.activeInnerDiagramIndex) {
    w.activeInnerDiagramIndex--;
  }
  bindActiveTab();
  refreshTabStrip();
  updateEditorContentVisibility();
  renderWorkspaceView();
}

async function saveWorkspaceSettings(
  w: WorkspaceDoc,
  name: string,
  description: string,
  autoSaveDiagrams: boolean
): Promise<void> {
  w.name = name;
  w.description = description;
  w.autoSaveDiagrams = autoSaveDiagrams;
  await saveWorkspaceConfig(w.rootPath, {
    name,
    description,
    autoSaveDiagrams,
  });
  w.label = name || w.label;
  refreshTabStrip();
  showToast("Settings saved");
}

function showWorkspaceSettingsModal(w: WorkspaceDoc): void {
  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const panel = document.createElement("div");
  panel.className = "modal-panel modal-panel-workspace-settings";

  const headerDiv = document.createElement("div");
  headerDiv.className = "modal-workspace-settings-header";
  const title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = "Edit Workspace Settings";
  headerDiv.appendChild(title);
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name";
  nameLabel.htmlFor = "workspace-settings-name";
  headerDiv.appendChild(nameLabel);
  const nameInput = document.createElement("input");
  nameInput.id = "workspace-settings-name";
  nameInput.type = "text";
  nameInput.value = w.name;
  nameInput.className = "modal-input";
  headerDiv.appendChild(nameInput);
  panel.appendChild(headerDiv);

  const contentDiv = document.createElement("div");
  contentDiv.className = "modal-workspace-settings-content";
  const descLabel = document.createElement("label");
  descLabel.textContent = "Description";
  descLabel.htmlFor = "workspace-settings-desc";
  contentDiv.appendChild(descLabel);
  const descInput = document.createElement("textarea");
  descInput.id = "workspace-settings-desc";
  descInput.className = "modal-input modal-textarea";
  descInput.rows = 3;
  descInput.value = w.description ?? "";
  contentDiv.appendChild(descInput);
  const autoSaveLabel = document.createElement("label");
  autoSaveLabel.className = "modal-checkbox-row";
  autoSaveLabel.style.cursor = "pointer";
  const autoSaveCheckbox = document.createElement("input");
  autoSaveCheckbox.type = "checkbox";
  autoSaveCheckbox.checked = w.autoSaveDiagrams ?? false;
  autoSaveLabel.appendChild(autoSaveCheckbox);
  const autoSaveText = document.createElement("span");
  autoSaveText.textContent =
    " Auto-save diagrams (within 5 seconds of changes)";
  autoSaveLabel.appendChild(autoSaveText);
  contentDiv.appendChild(autoSaveLabel);
  panel.appendChild(contentDiv);

  const footerDiv = document.createElement("div");
  footerDiv.className = "modal-workspace-settings-footer";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => overlay.remove();
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "Save";
  saveBtn.onclick = async () => {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    const autoSaveDiagrams = autoSaveCheckbox.checked;
    overlay.remove();
    await saveWorkspaceSettings(w, name, description, autoSaveDiagrams);
    if (workspacePanelEl) renderWorkspaceView();
  };
  footerDiv.appendChild(cancelBtn);
  footerDiv.appendChild(saveBtn);
  panel.appendChild(footerDiv);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function openCatalogTableEditor(w: WorkspaceDoc, catalogId: string): void {
  const catalogEntry = w.catalogTables.find((c) => c.id === catalogId);
  if (!catalogEntry) return;
  showCatalogTableEditor(w, catalogId);
}

/** Collect diagram names (open tabs + closed files on disk) that contain a table with this catalogId. */
async function getDiagramsUsingCatalogTable(
  w: WorkspaceDoc,
  catalogId: string
): Promise<string[]> {
  const openPaths = new Set(w.innerDiagramTabs.map((t) => t.path));
  const namesFromOpenTabs = w.innerDiagramTabs
    .filter((tab) => {
      const d = tab.store.getDiagram();
      return d.tables.some((t) => t.catalogTableId === catalogId);
    })
    .map((tab) => tab.label);

  if (!bridge.isBackendAvailable()) return namesFromOpenTabs;

  const namesFromFiles: string[] = [];
  try {
    const files = await loadWorkspaceDiagramFiles(w);
    for (const filename of files) {
      const fullPath = pathJoin(w.rootPath, filename);
      if (openPaths.has(fullPath)) continue;
      try {
        const raw = await bridge.loadFile(fullPath);
        const d = JSON.parse(raw) as Diagram;
        const used =
          d.tables?.some((t) => t.catalogTableId === catalogId) ?? false;
        if (used)
          namesFromFiles.push(filename.replace(/\.diagram$/i, "") || "Diagram");
      } catch {
        // skip unreadable file
      }
    }
  } catch {
    // fallback to open tabs only
  }

  const combined = [...new Set([...namesFromOpenTabs, ...namesFromFiles])];
  return combined;
}

/** Show confirmation dialog, then remove catalog table and delete it from all diagrams that use it. */
async function confirmRemoveCatalogTable(
  w: WorkspaceDoc,
  catalogId: string,
  tableName: string
): Promise<void> {
  const diagramNames = await getDiagramsUsingCatalogTable(w, catalogId);
  const usedInDiagrams = diagramNames.length > 0;
  const message = usedInDiagrams
    ? `Table "${tableName}" is currently used in diagram${
        diagramNames.length === 1 ? "" : "s"
      } ${diagramNames.join(
        ", "
      )}. Deleting this table will also remove it from all diagrams.`
    : `Remove "${tableName}" from the catalog?`;

  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const panel = document.createElement("div");
  panel.className = "modal-panel modal-panel-confirm";

  const headerDiv = document.createElement("div");
  headerDiv.className = "modal-confirm-header";
  const title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = "Delete table";
  headerDiv.appendChild(title);
  panel.appendChild(headerDiv);

  const contentDiv = document.createElement("div");
  contentDiv.className = "modal-confirm-content";
  const p = document.createElement("p");
  p.textContent = message;
  p.className = "modal-confirm-message";
  contentDiv.appendChild(p);
  panel.appendChild(contentDiv);

  const footerDiv = document.createElement("div");
  footerDiv.className = "modal-confirm-footer";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => overlay.remove();
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.className = "modal-confirm-delete-btn";
  deleteBtn.onclick = () => {
    overlay.remove();
    removeCatalogTable(w, catalogId);
  };
  footerDiv.appendChild(cancelBtn);
  footerDiv.appendChild(deleteBtn);
  panel.appendChild(footerDiv);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

/** Show confirmation dialog, then delete the diagram file and close its tab if open. */
function confirmDeleteDiagram(w: WorkspaceDoc, filename: string): void {
  const message = `Delete diagram "${filename}"? This cannot be undone.`;

  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const panel = document.createElement("div");
  panel.className = "modal-panel modal-panel-confirm";

  const headerDiv = document.createElement("div");
  headerDiv.className = "modal-confirm-header";
  const title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = "Delete diagram";
  headerDiv.appendChild(title);
  panel.appendChild(headerDiv);

  const contentDiv = document.createElement("div");
  contentDiv.className = "modal-confirm-content";
  const p = document.createElement("p");
  p.textContent = message;
  p.className = "modal-confirm-message";
  contentDiv.appendChild(p);
  panel.appendChild(contentDiv);

  const footerDiv = document.createElement("div");
  footerDiv.className = "modal-confirm-footer";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.onclick = () => overlay.remove();
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.className = "modal-confirm-delete-btn";
  deleteBtn.onclick = () => {
    overlay.remove();
    deleteDiagramFile(w, filename).catch((e) =>
      showToast("Delete failed: " + (e as Error).message)
    );
  };
  footerDiv.appendChild(cancelBtn);
  footerDiv.appendChild(deleteBtn);
  panel.appendChild(footerDiv);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

async function deleteDiagramFile(
  w: WorkspaceDoc,
  filename: string
): Promise<void> {
  if (!bridge.isBackendAvailable()) {
    showToast("Backend not available");
    return;
  }
  const fullPath = pathJoin(w.rootPath, filename);
  const tabIndex = w.innerDiagramTabs.findIndex((t) => t.path === fullPath);
  if (tabIndex >= 0) {
    w.innerDiagramTabs.splice(tabIndex, 1);
    if (w.activeInnerDiagramIndex >= w.innerDiagramTabs.length) {
      w.activeInnerDiagramIndex = Math.max(0, w.innerDiagramTabs.length - 1);
    } else if (tabIndex < w.activeInnerDiagramIndex) {
      w.activeInnerDiagramIndex--;
    }
    bindActiveTab();
  }
  await bridge.removeFile(fullPath);
  refreshTabStrip();
  if (workspacePanelEl) renderWorkspaceView();
  updateEditorContentVisibility();
  appendStatus("Diagram deleted");
}

async function removeCatalogTable(
  w: WorkspaceDoc,
  catalogId: string
): Promise<void> {
  const idx = w.catalogTables.findIndex((c) => c.id === catalogId);
  if (idx < 0) return;
  const openPaths = new Set(w.innerDiagramTabs.map((t) => t.path));

  for (const tab of w.innerDiagramTabs) {
    const d = tab.store.getDiagram();
    const table = d.tables.find((t) => t.catalogTableId === catalogId);
    if (table) tab.store.deleteTable(table.id);
  }

  if (bridge.isBackendAvailable()) {
    try {
      const files = await loadWorkspaceDiagramFiles(w);
      for (const filename of files) {
        const fullPath = pathJoin(w.rootPath, filename);
        if (openPaths.has(fullPath)) continue;
        try {
          const raw = await bridge.loadFile(fullPath);
          const d = JSON.parse(raw) as Diagram;
          const tableToRemove = d.tables?.find(
            (t) => t.catalogTableId === catalogId
          );
          if (tableToRemove) {
            const tableId = tableToRemove.id;
            d.tables = (d.tables ?? []).filter((t) => t.id !== tableId);
            d.relationships = (d.relationships ?? []).filter(
              (r) => r.sourceTableId !== tableId && r.targetTableId !== tableId
            );
            await bridge.saveFile(fullPath, JSON.stringify(d));
          }
        } catch {
          // skip unreadable/unwritable file
        }
      }
    } catch {
      // ignore
    }
  }

  w.catalogRelationships = w.catalogRelationships.filter(
    (r) =>
      r.sourceCatalogTableId !== catalogId &&
      r.targetCatalogTableId !== catalogId
  );
  w.catalogTables.splice(idx, 1);
  await saveTableCatalog(w.rootPath, w.catalogTables);
  await saveCatalogRelationships(w.rootPath, w.catalogRelationships);
  refreshTabStrip();
  updateEditorContentVisibility();
  renderWorkspaceView();
  showToast("Removed from catalog");
}

function showEditor(): void {
  viewMode = "editor";
  rootContainer.innerHTML = "";
  rootContainer.className = "app-root app-editor";

  menuBarEl = document.createElement("div");
  menuBarEl.className = "menu-bar";
  setupMenuBar(menuBarEl);
  rootContainer.appendChild(menuBarEl);

  tabStripEl = document.createElement("div");
  tabStripEl.className = "tab-strip";
  rootContainer.appendChild(tabStripEl);

  editorContentEl = document.createElement("div");
  editorContentEl.className = "editor-content";
  rootContainer.appendChild(editorContentEl);

  if (!diagramPanelEl) {
    diagramPanelEl = document.createElement("div");
    diagramPanelEl.className = "diagram-panel";
    container = diagramPanelEl;
    setupToolbar();
    setupCanvas();
    editorInitialized = true;
  }
  if (diagramPanelEl.parentNode !== editorContentEl) {
    editorContentEl.appendChild(diagramPanelEl);
  }
  diagramPanelEl.style.display = "";

  bindActiveTab();
  refreshTabStrip();
  updateStatusContext();
  updateMenuState();
  appendStatus("Ready. Use Import/Export from the toolbar.");
}

function setupMenuBar(menuBar: HTMLElement): void {
  const fileMenu = document.createElement("div");
  fileMenu.className = "menu-bar-item";
  const fileBtn = document.createElement("button");
  fileBtn.className = "menu-bar-btn";
  fileBtn.textContent = "File";
  fileBtn.onclick = () => toggleMenu(fileMenu);
  fileMenu.appendChild(fileBtn);
  const fileDropdown = document.createElement("div");
  fileDropdown.className = "menu-bar-dropdown";
  const fileItems = [
    ["New Workspace", () => newWorkspaceTab(), false],
    ["Open Workspace", () => openWorkspaceTab(), false],
    ["New Diagram", () => newDiagramTab(), false],
    ["Open Diagram", () => openDiagramTab(), false],
    null,
    ["Save", () => saveDiagram().then((s) => s && showToast("Saved")), false],
    [
      "Save As…",
      () => saveDiagramAs().then((s) => s && showToast("Saved")),
      false,
    ],
    ["Close Diagram", () => closeActiveDiagram(), false],
    ["Close Workspace", () => closeWorkspaceTab(), false],
    ["Close All Diagrams", () => closeAllDiagramTabs(), false],
    null,
    ["Exit", () => window.close(), false],
  ] as [string, () => void | Promise<void>, boolean][];
  const fileActionMap: Record<string, string> = {
    "Close Diagram": "close-diagram",
    "Close Workspace": "close-workspace",
  };
  fileItems.forEach((item) => {
    if (item === null) {
      const sep = document.createElement("div");
      sep.className = "menu-bar-sep";
      fileDropdown.appendChild(sep);
      return;
    }
    const [label, fn, disabled] = item;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-bar-dropdown-item";
    b.textContent = label;
    b.disabled = disabled as boolean;
    const action = fileActionMap[label as string];
    if (action) b.dataset.menuAction = action;
    b.onclick = () => {
      hideMenus();
      (fn as () => void)();
    };
    fileDropdown.appendChild(b);
  });
  fileMenu.appendChild(fileDropdown);
  menuBar.appendChild(fileMenu);

  const editMenu = document.createElement("div");
  editMenu.className = "menu-bar-item";
  const editBtn = document.createElement("button");
  editBtn.className = "menu-bar-btn";
  editBtn.textContent = "Edit";
  editBtn.onclick = () => toggleMenu(editMenu);
  editMenu.appendChild(editBtn);
  const editDropdown = document.createElement("div");
  editDropdown.className = "menu-bar-dropdown";
  [
    [
      "Workspace Settings",
      () => {
        const doc = getActiveDoc();
        if (doc?.type === "workspace")
          showWorkspaceSettingsModal(doc as WorkspaceDoc);
      },
      false,
    ],
    null,
    ["Undo", () => store.undo(), false],
    ["Redo", () => store.redo(), false],
    null,
    ["New Table", () => addTableFromToolbar(), false],
    null,
    ["Toggle Light/Dark Theme", () => toggleTheme(), false],
  ].forEach((item) => {
    if (item === null) {
      const sep = document.createElement("div");
      sep.className = "menu-bar-sep";
      editDropdown.appendChild(sep);
      return;
    }
    const [label, fn] = item as [string, () => void];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-bar-dropdown-item";
    b.textContent = label;
    if (label === "Workspace Settings")
      b.dataset.menuAction = "workspace-settings";
    b.onclick = () => {
      hideMenus();
      fn();
    };
    editDropdown.appendChild(b);
  });
  editMenu.appendChild(editDropdown);
  menuBar.appendChild(editMenu);

  const toolsMenu = document.createElement("div");
  toolsMenu.className = "menu-bar-item";
  const toolsBtn = document.createElement("button");
  toolsBtn.className = "menu-bar-btn";
  toolsBtn.textContent = "Tools";
  toolsBtn.onclick = () => toggleMenu(toolsMenu);
  toolsMenu.appendChild(toolsBtn);
  const toolsDropdown = document.createElement("div");
  toolsDropdown.className = "menu-bar-dropdown";

  const importWrapper = document.createElement("div");
  importWrapper.className = "menu-bar-submenu-wrapper";
  const importRow = document.createElement("div");
  importRow.className = "menu-bar-submenu-row";
  importRow.textContent = "Import Tables";
  const importArrow = document.createElement("span");
  importArrow.className = "menu-bar-submenu-arrow";
  importArrow.textContent = "\u25B8";
  importRow.appendChild(importArrow);
  const importFlyout = document.createElement("div");
  importFlyout.className = "menu-bar-flyout";
  const fromSqlItem = document.createElement("button");
  fromSqlItem.type = "button";
  fromSqlItem.className = "menu-bar-dropdown-item";
  fromSqlItem.textContent = "From SQL DDL";
  fromSqlItem.onclick = () => {
    hideMenus();
    openAndImportSQL();
  };
  importFlyout.appendChild(fromSqlItem);
  const fromCsvItem = document.createElement("button");
  fromCsvItem.type = "button";
  fromCsvItem.className = "menu-bar-dropdown-item";
  fromCsvItem.textContent = "From CSV";
  fromCsvItem.onclick = () => {
    hideMenus();
    openAndImportCSV();
  };
  importFlyout.appendChild(fromCsvItem);
  importWrapper.appendChild(importRow);
  importWrapper.appendChild(importFlyout);
  toolsDropdown.appendChild(importWrapper);

  const sep1 = document.createElement("div");
  sep1.className = "menu-bar-sep";
  toolsDropdown.appendChild(sep1);

  const exportWrapper = document.createElement("div");
  exportWrapper.className = "menu-bar-submenu-wrapper";
  const exportRow = document.createElement("div");
  exportRow.className = "menu-bar-submenu-row";
  exportRow.textContent = "Export";
  const exportArrow = document.createElement("span");
  exportArrow.className = "menu-bar-submenu-arrow";
  exportArrow.textContent = "\u25B8";
  exportRow.appendChild(exportArrow);
  const exportFlyout = document.createElement("div");
  exportFlyout.className = "menu-bar-flyout";

  const sqlDdlWrapper = document.createElement("div");
  sqlDdlWrapper.className = "menu-bar-submenu-wrapper";
  const sqlDdlRow = document.createElement("div");
  sqlDdlRow.className = "menu-bar-submenu-row";
  sqlDdlRow.textContent = "Export SQL DDL";
  const sqlDdlArrow = document.createElement("span");
  sqlDdlArrow.className = "menu-bar-submenu-arrow";
  sqlDdlArrow.textContent = "\u25B8";
  sqlDdlRow.appendChild(sqlDdlArrow);
  const sqlDdlFlyout = document.createElement("div");
  sqlDdlFlyout.className = "menu-bar-flyout";

  const bigQueryItem = document.createElement("button");
  bigQueryItem.type = "button";
  bigQueryItem.className = "menu-bar-dropdown-item";
  bigQueryItem.textContent = "Export BigQuery DDL";
  bigQueryItem.onclick = () => {
    hideMenus();
    exportBigQuerySQL().catch((e) => showToast((e as Error).message));
  };
  sqlDdlFlyout.appendChild(bigQueryItem);
  const postgresItem = document.createElement("button");
  postgresItem.type = "button";
  postgresItem.className = "menu-bar-dropdown-item";
  postgresItem.textContent = "Export PostgreSQL DDL";
  postgresItem.onclick = () => {
    hideMenus();
    exportPostgresSQL().catch((e) => showToast((e as Error).message));
  };
  sqlDdlFlyout.appendChild(postgresItem);
  sqlDdlWrapper.appendChild(sqlDdlRow);
  sqlDdlWrapper.appendChild(sqlDdlFlyout);
  exportFlyout.appendChild(sqlDdlWrapper);

  const exportItems: [string, () => void][] = [
    ["Export as PNG", () => exportPNG()],
    ["Export as SVG", () => exportSVG()],
    [
      "Export in Mermaid format",
      () => exportMermaid().catch((e) => showToast((e as Error).message)),
    ],
    [
      "Export in PlantUML format",
      () => exportPlantUML().catch((e) => showToast((e as Error).message)),
    ],
  ];
  exportItems.forEach(([exportLabel, fn]) => {
    const subItem = document.createElement("button");
    subItem.type = "button";
    subItem.className = "menu-bar-dropdown-item";
    subItem.textContent = exportLabel;
    subItem.onclick = () => {
      hideMenus();
      fn();
    };
    exportFlyout.appendChild(subItem);
  });

  exportWrapper.appendChild(exportRow);
  exportWrapper.appendChild(exportFlyout);
  toolsDropdown.appendChild(exportWrapper);

  const sep2 = document.createElement("div");
  sep2.className = "menu-bar-sep";
  toolsDropdown.appendChild(sep2);

  const layoutWrapper = document.createElement("div");
  layoutWrapper.className = "menu-bar-submenu-wrapper";
  const layoutRow = document.createElement("div");
  layoutRow.className = "menu-bar-submenu-row";
  layoutRow.textContent = "Layout";
  const layoutArrow = document.createElement("span");
  layoutArrow.className = "menu-bar-submenu-arrow";
  layoutArrow.textContent = "\u25B8";
  layoutRow.appendChild(layoutArrow);
  const layoutFlyout = document.createElement("div");
  layoutFlyout.className = "menu-bar-flyout";
  const layoutItems: [string, "grid" | "hierarchical" | "force"][] = [
    ["Grid", "grid"],
    ["Hierarchical", "hierarchical"],
    ["Force-directed", "force"],
  ];
  layoutItems.forEach(([layoutLabel, layout]) => {
    const subItem = document.createElement("button");
    subItem.type = "button";
    subItem.className = "menu-bar-dropdown-item";
    subItem.textContent = layoutLabel;
    subItem.onclick = () => {
      hideMenus();
      store.applyLayout(layout);
    };
    layoutFlyout.appendChild(subItem);
  });
  layoutWrapper.appendChild(layoutRow);
  layoutWrapper.appendChild(layoutFlyout);
  toolsDropdown.appendChild(layoutWrapper);

  toolsMenu.appendChild(toolsDropdown);
  menuBar.appendChild(toolsMenu);

  document.addEventListener("click", (e) => {
    if (!(e.target as Element).closest(".menu-bar-item")) hideMenus();
  });
}

function hideMenus(): void {
  rootContainer
    .querySelectorAll(".menu-bar-item.open")
    .forEach((el) => el.classList.remove("open"));
}

function toggleMenu(menuItem: HTMLElement): void {
  const wasOpen = menuItem.classList.contains("open");
  hideMenus();
  if (!wasOpen) menuItem.classList.add("open");
}

function toggleTheme(): void {
  const theme = document.documentElement.getAttribute("data-theme") ?? "dark";
  const next = theme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("erd-theme", next);
  } catch (_) {}
  showToast(next === "dark" ? "Dark theme" : "Light theme");
}

function nextCatalogId(): string {
  return "catalog-" + Math.random().toString(36).slice(2, 11);
}

function nextFieldId(): string {
  return "f-" + Math.random().toString(36).slice(2, 11);
}

function nextCatalogRelationshipId(): string {
  return "crel-" + Math.random().toString(36).slice(2, 11);
}

async function syncRelationshipToCatalog(
  w: WorkspaceDoc,
  diagram: Diagram,
  rel: Relationship
): Promise<void> {
  const srcT = diagram.tables.find((t) => t.id === rel.sourceTableId);
  const tgtT = diagram.tables.find((t) => t.id === rel.targetTableId);
  if (!srcT?.catalogTableId || !tgtT?.catalogTableId) return;
  const srcField = srcT.fields.find(
    (f) => f.id === (rel.sourceFieldIds?.[0] ?? rel.sourceFieldId)
  );
  const tgtField = tgtT.fields.find(
    (f) => f.id === (rel.targetFieldIds?.[0] ?? rel.targetFieldId)
  );
  if (!srcField || !tgtField) return;
  const catalogRel: CatalogRelationship = {
    id: nextCatalogRelationshipId(),
    sourceCatalogTableId: srcT.catalogTableId,
    targetCatalogTableId: tgtT.catalogTableId,
    sourceFieldName: srcField.name,
    targetFieldName: tgtField.name,
  };
  w.catalogRelationships.push(catalogRel);
  rel.catalogRelationshipId = catalogRel.id;
  await saveCatalogRelationships(w.rootPath, w.catalogRelationships);
}

async function syncRelationshipRemovalFromCatalog(
  w: WorkspaceDoc,
  rel: Relationship
): Promise<void> {
  if (!rel.catalogRelationshipId) return;
  const idx = w.catalogRelationships.findIndex(
    (r) => r.id === rel.catalogRelationshipId
  );
  if (idx >= 0) {
    w.catalogRelationships.splice(idx, 1);
    await saveCatalogRelationships(w.rootPath, w.catalogRelationships);
  }
}

async function syncRelationshipUpdateToCatalog(
  w: WorkspaceDoc,
  diagram: Diagram,
  rel: Relationship
): Promise<void> {
  if (!rel.catalogRelationshipId) return;
  const catRel = w.catalogRelationships.find(
    (r) => r.id === rel.catalogRelationshipId
  );
  if (!catRel) return;
  const srcT = diagram.tables.find((t) => t.id === rel.sourceTableId);
  const tgtT = diagram.tables.find((t) => t.id === rel.targetTableId);
  const srcField = srcT?.fields.find(
    (f) => f.id === (rel.sourceFieldIds?.[0] ?? rel.sourceFieldId)
  );
  const tgtField = tgtT?.fields.find(
    (f) => f.id === (rel.targetFieldIds?.[0] ?? rel.targetFieldId)
  );
  if (srcField) catRel.sourceFieldName = srcField.name;
  if (tgtField) catRel.targetFieldName = tgtField.name;
  await saveCatalogRelationships(w.rootPath, w.catalogRelationships);
}

/** Create diagram relationships from catalog for the just-added table (by catalog id). */
function createDiagramRelationshipsFromCatalog(
  w: WorkspaceDoc,
  inner: InnerDiagramTab,
  addedCatalogId: string,
  newTable: Table
): void {
  const d = inner.store.getDiagram();
  for (const catRel of w.catalogRelationships) {
    const weAreSource = catRel.sourceCatalogTableId === addedCatalogId;
    const weAreTarget = catRel.targetCatalogTableId === addedCatalogId;
    if (!weAreSource && !weAreTarget) continue;
    const otherCatalogId = weAreSource
      ? catRel.targetCatalogTableId
      : catRel.sourceCatalogTableId;
    const otherTable = d.tables.find(
      (t) => t.catalogTableId === otherCatalogId
    );
    if (!otherTable) continue;
    const ourFieldName = weAreSource
      ? catRel.sourceFieldName
      : catRel.targetFieldName;
    const otherFieldName = weAreSource
      ? catRel.targetFieldName
      : catRel.sourceFieldName;
    const ourField = newTable.fields.find((f) => f.name === ourFieldName);
    const otherField = otherTable.fields.find((f) => f.name === otherFieldName);
    if (!ourField || !otherField) continue;
    const sourceTableId = weAreSource ? newTable.id : otherTable.id;
    const targetTableId = weAreSource ? otherTable.id : newTable.id;
    const sourceFieldId = weAreSource ? ourField.id : otherField.id;
    const targetFieldId = weAreSource ? otherField.id : ourField.id;
    const r = inner.store.addRelationshipWithMeta(
      sourceTableId,
      [sourceFieldId],
      targetTableId,
      [targetFieldId]
    );
    r.catalogRelationshipId = catRel.id;
  }
}

/** When saving a diagram, ensure every relationship in the diagram (between catalog-linked tables) exists in the catalog. Call before writing the diagram file. */
async function syncDiagramRelationshipsToCatalog(
  w: WorkspaceDoc,
  diagram: Diagram
): Promise<void> {
  const relationships = diagram.relationships ?? [];
  let changed = false;
  for (const rel of relationships) {
    const srcT = diagram.tables.find((t) => t.id === rel.sourceTableId);
    const tgtT = diagram.tables.find((t) => t.id === rel.targetTableId);
    if (!srcT?.catalogTableId || !tgtT?.catalogTableId) continue;
    const srcField = srcT.fields.find(
      (f) => f.id === (rel.sourceFieldIds?.[0] ?? rel.sourceFieldId)
    );
    const tgtField = tgtT.fields.find(
      (f) => f.id === (rel.targetFieldIds?.[0] ?? rel.targetFieldId)
    );
    if (!srcField || !tgtField) continue;
    const sourceCatalogTableId = srcT.catalogTableId;
    const targetCatalogTableId = tgtT.catalogTableId;
    const sourceFieldName = srcField.name;
    const targetFieldName = tgtField.name;
    const alreadyInCatalog = w.catalogRelationships.some(
      (r) =>
        r.sourceCatalogTableId === sourceCatalogTableId &&
        r.targetCatalogTableId === targetCatalogTableId &&
        r.sourceFieldName === sourceFieldName &&
        r.targetFieldName === targetFieldName
    );
    if (!alreadyInCatalog) {
      w.catalogRelationships.push({
        id: nextCatalogRelationshipId(),
        sourceCatalogTableId,
        targetCatalogTableId,
        sourceFieldName,
        targetFieldName,
      });
      changed = true;
    }
  }
  if (changed)
    await saveCatalogRelationships(w.rootPath, w.catalogRelationships);
}

async function syncTableToCatalogAndDiagrams(tableId: string): Promise<void> {
  const doc = getActiveDoc();
  if (doc?.type !== "workspace") return;
  const w = doc as WorkspaceDoc;
  const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
  if (!inner) return;
  const d = inner.store.getDiagram();
  const table = d.tables.find((t) => t.id === tableId);
  if (!table?.catalogTableId) return;
  const catalogEntry = w.catalogTables.find(
    (c) => c.id === table.catalogTableId
  );
  if (!catalogEntry) return;
  catalogEntry.name = table.name;
  catalogEntry.fields = table.fields.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    nullable: f.nullable,
    primaryKey: f.primaryKey,
  }));
  for (const tab of w.innerDiagramTabs) {
    if (tab === inner) continue;
    const otherD = tab.store.getDiagram();
    const otherTable = otherD.tables.find(
      (t) => t.catalogTableId === table.catalogTableId
    );
    if (otherTable) {
      const otherFields = otherTable.fields;
      const fields = catalogEntry.fields.map((cf, i) => ({
        id: otherFields[i]?.id,
        name: cf.name,
        type: cf.type,
        nullable: cf.nullable,
        primaryKey: cf.primaryKey,
      }));
      tab.store.replaceTableContent(otherTable.id, catalogEntry.name, fields);
      await syncDiagramRelationshipsToCatalog(w, tab.store.getDiagram());
      await bridge.saveFile(tab.path, JSON.stringify(tab.store.getDiagram()));
      tab.store.clearDirty();
    }
  }
  await saveTableCatalog(w.rootPath, w.catalogTables);
  refreshTabStrip();
  updateEditorContentVisibility();
  renderWorkspaceView();
}

/** Add a table at (x, y). In a workspace, also add to catalog and link (table id = catalog id). */
function addTableToCurrentDiagram(x: number, y: number): void {
  const doc = getActiveDoc();
  if (!doc) return;
  if (doc.type === "workspace") {
    const w = doc as WorkspaceDoc;
    const inner = w.innerDiagramTabs[w.activeInnerDiagramIndex];
    if (!inner) {
      showToast("Open or create a diagram first");
      return;
    }
    const d = inner.store.getDiagram();
    const name = "Table" + (d.tables.length + 1);
    const defaultFields = [{ name: "id", type: "int" }];
    const catalogId = nextCatalogId();
    const catalogEntry: CatalogTable = {
      id: catalogId,
      name,
      fields: defaultFields.map((f) => ({
        id: nextFieldId(),
        name: f.name,
        type: f.type,
        nullable: false,
        primaryKey: false,
      })),
    };
    w.catalogTables.push(catalogEntry);
    inner.store.addTableWithContent(x, y, name, defaultFields, catalogId);
    saveTableCatalog(w.rootPath, w.catalogTables).catch((e) =>
      showToast("Failed to save catalog: " + (e as Error).message)
    );
    render();
    refreshTabStrip();
    updateEditorContentVisibility();
    renderWorkspaceView();
    appendStatus("Table added to diagram and catalog.");
  } else {
    doc.store.addTable(x, y);
    render();
    appendStatus("Table added.");
  }
}

function addTableFromToolbar(): void {
  addTableToCurrentDiagram(200, 200);
}

async function closeActiveDiagram(): Promise<void> {
  const doc = getActiveDoc();
  if (doc?.type === "workspace") {
    const w = doc as WorkspaceDoc;
    if (
      w.innerDiagramTabs.length > 0 &&
      w.activeInnerDiagramIndex >= 0 &&
      w.activeInnerDiagramIndex < w.innerDiagramTabs.length
    ) {
      await closeWorkspaceInnerTab(w, w.activeInnerDiagramIndex);
    }
  } else if (doc?.type === "diagram") {
    await closeTab(activeDocIndex);
  }
}

async function closeWorkspaceTab(): Promise<void> {
  if (!currentWorkspace) return;
  currentWorkspace = null;
  workspacePanelEl = null;
  if (documents.length > 0) {
    activeDocIndex = 0;
    showEditor();
  } else {
    store = new Store();
    currentFilePath = null;
    showLanding();
  }
}

async function closeAllDiagramTabs(): Promise<void> {
  const doc = getActiveDoc();
  if (doc?.type === "workspace") {
    const w = doc as WorkspaceDoc;
    while (w.innerDiagramTabs.length > 0) {
      await closeWorkspaceInnerTab(w, 0);
    }
  } else {
    while (documents.length > 0) {
      await closeTab(0);
    }
  }
}

export function init(el: HTMLElement): void {
  rootContainer = el;
  container = el;
  store = new Store();
  documents = [];
  activeDocIndex = -1;
  currentWorkspace = null;
  editorInitialized = false;
  // Prevent browser context menu app-wide; custom menus (canvas, diagram list) use their own handlers
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  showLanding();
}
